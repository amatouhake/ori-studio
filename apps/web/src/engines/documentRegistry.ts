import type { DesignKindDescriptor } from '../designKinds/types';
import { onEngineLost, type EngineId } from './engineHost';

/**
 * Owner of design-document engine handles.
 *
 * Today each engine module holds one handle in a module-level `let`, and
 * replacing it frees the old one — so leaks are structurally impossible and
 * memory is bounded by construction. N documents removes both guarantees at
 * once, which is why handle lifetime becomes an explicit thing with an owner
 * rather than a side effect of loading.
 *
 * Three jobs:
 *
 * - **Hydrate on demand.** A document's serialized text is the source of truth;
 *   a handle is a cache of it. `acquire()` materializes one, `park()` gives it back.
 * - **Bound the cache.** At most {@link DocumentRegistryOptions.hotLimit} handles
 *   live at once, least-recently-used evicted first.
 * - **Survive an engine dying.** A crashed worker takes every handle it held;
 *   the documents are fine, so they are parked rather than lost.
 *
 * It deliberately knows nothing about tabs, the store, or which document is
 * on screen. It maps document id -> handle, and that is all.
 */

/** A document as the registry sees it: an id, a kind, and its serialized form. */
export interface RegisteredDocument {
  id: string;
  kind: DesignKindDescriptor;
}

export interface DocumentRegistryOptions {
  /**
   * How many handles may be live at once. Three by default: enough that flipping
   * between a couple of designs never pays a hydration cost, small enough that
   * a set of large designs cannot multiply peak memory without bound.
   *
   * A **target**, not a hard cap — pinned documents are never evicted, so a
   * registry whose every hot slot is pinned will exceed it rather than free a
   * handle something is still writing to.
   */
  hotLimit?: number;
  /**
   * Where engine-loss notifications come from. Defaults to the real host.
   *
   * Injected for the same reason the codecs take their client that way: a
   * registry that reached for a module-level subscription could only be tested
   * by actually killing a worker, and every test would share one global listener
   * list — so a crash in one test would reach registries left over from another.
   */
  subscribeToEngineLoss?: typeof onEngineLost;
}

interface HotEntry {
  document: RegisteredDocument;
  handle: number;
  /** Monotonic counter; lowest is least-recently-used. */
  touched: number;
}

export const DEFAULT_HOT_LIMIT = 3;

export type DocumentRegistryEvent =
  | { type: 'hydrated'; documentId: string; handle: number }
  | {
      type: 'parked';
      documentId: string;
      reason: 'evicted' | 'released' | 'engine-lost';
      /**
       * Whether serialized text survives, so the document can be hydrated again.
       *
       * Always true for an ordinary park or eviction. False only when an engine
       * died holding a document that had never been parked — a design created and
       * never switched away from. Its content really is gone, and saying so is
       * better than hydrating a tab from an empty string.
       */
      recoverable: boolean;
    };

export function createDocumentRegistry(options: DocumentRegistryOptions = {}) {
  const hotLimit = options.hotLimit ?? DEFAULT_HOT_LIMIT;
  const hot = new Map<string, HotEntry>();
  /** Serialized text for every document the registry has parked. */
  const parked = new Map<string, string>();
  /**
   * Outstanding pins per document id.
   *
   * Keyed by id and held *outside* the hot entry on purpose: a pin has to exist
   * from the moment `pinned` is called, which is before the handle it protects
   * has finished hydrating. Storing the count on the entry meant a concurrent
   * `acquire()` could evict the document during that window — the exact thing pinning
   * is for.
   */
  const pins = new Map<string, number>();
  const isPinned = (documentId: string) => (pins.get(documentId) ?? 0) > 0;
  /**
   * Ownership generation per document id.
   *
   * Bumped on every ownership/state change — a new park starting, `adopt`,
   * `adoptHandle`, `forget`, an engine-loss drop. A park captures the
   * generation when it starts and may still free the handle it started with,
   * but must never commit serialized text once the generation has moved: the
   * text it holds describes a document that no longer exists.
   */
  const generations = new Map<string, number>();
  const bumpGeneration = (documentId: string): number => {
    const next = (generations.get(documentId) ?? 0) + 1;
    generations.set(documentId, next);
    return next;
  };
  /**
   * A park currently serializing a document whose hot entry is already gone.
   *
   * Waiters await `done`, never the worker RPC directly: if the engine dies
   * mid-serialize, its Comlink promise pends forever, and `handleEngineLost`
   * settles `done` via `abandon()` instead so `acquire()`/`serialize()`/`park()`
   * proceed from the last parked text. A late settlement of the original work
   * still runs its generation check, so it can free but never commit.
   */
  interface InFlightPark {
    /** Settles when the park commits — or when an engine loss abandons it. */
    done: Promise<void>;
    /** Release waiters without waiting for the worker. Resolving twice is a no-op. */
    abandon: () => void;
    /** Engine whose death strands this park; null when the kind has no engine. */
    engine: EngineId | null;
  }
  /**
   * Parks currently serializing, by document id.
   *
   * Keyed by id and held *outside* the hot entry on purpose, like `pins`: the
   * entry is already gone while a park is in flight, so there is nowhere else
   * to record that the parked text is about to be replaced.
   */
  const parksInFlight = new Map<string, InFlightPark>();
  const listeners = new Set<(event: DocumentRegistryEvent) => void>();
  let clock = 0;

  const emit = (event: DocumentRegistryEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ori-studio] document registry listener failed', error);
      }
    }
  };

  /**
   * Evict least-recently-used handles until the hot set is within budget.
   *
   * Parking serializes first, so an eviction never loses work. Pinned entries are
   * skipped: a document with an optimizer running is being written to, and both
   * freeing its handle and serializing it mid-run would be wrong.
   */
  const evictIfNeeded = async (protectId: string) => {
    while (hot.size > hotLimit) {
      const candidates = [...hot.values()]
        .filter((entry) => !isPinned(entry.document.id) && entry.document.id !== protectId)
        .sort((a, b) => a.touched - b.touched);
      const victim = candidates[0];
      // Everything else is pinned or is the document we just hydrated. Exceeding
      // the limit beats freeing a handle that is in use.
      if (!victim) return;
      await park(victim.document.id, 'evicted');
    }
  };

  /**
   * Serialize a document's handle, free it, and remember the text.
   *
   * Safe to call for a document that is already parked or was never hot.
   */
  async function park(
    documentId: string,
    reason: 'evicted' | 'released' = 'released'
  ): Promise<void> {
    const entry = hot.get(documentId);
    if (!entry) {
      // A park is already serializing this document: waiting for it is what
      // makes `await park()` mean the text is safely parked, instead of
      // resolving while the earlier park is still mid-window.
      const parking = parksInFlight.get(documentId);
      if (parking) await parking.done;
      return;
    }
    // Engine work is in flight. Serializing would capture a torn intermediate
    // state, and freeing would pull the handle out from under it. The caller
    // switching tabs mid-optimize simply keeps this document hot until it ends.
    if (isPinned(documentId)) return;
    // Removed before the awaits: a second `park` racing this one must not
    // serialize and free the same handle twice.
    hot.delete(documentId);
    // Captured alongside the removal: any ownership change after this point —
    // `adopt`, `adoptHandle`, `forget`, a newer park, an engine-loss drop —
    // bumps the generation, and this park must then free but never commit.
    // Its text describes the document as it was when the park started.
    const epoch = bumpGeneration(documentId);
    // Marked before the awaits, alongside the removal: an `acquire` landing in
    // the serialize/free window must wait for this park and hydrate from the
    // text it stores — not mint a blank handle from nothing parked yet, or a
    // stale one from the text being replaced. Set synchronously here, so there
    // is no gap between the removal above and the marker for anyone to slip through.
    let committed = false;
    const work = (async () => {
      let text: string | undefined;
      try {
        text = await entry.document.kind.codec.serialize(entry.handle);
      } catch (error) {
        // Serialization failed, so the last known text is all there is. Keeping it
        // loses the edits since, but dropping the entry entirely would lose the
        // document — and the handle still has to be freed either way.
        console.error(`[ori-studio] failed to serialize document ${documentId}`, error);
      }
      // Always freed: this handle was removed from the hot set above, so nobody
      // else will free it — not even the ownership change that made this park
      // stale.
      await entry.document.kind.codec.free(entry.handle);
      if (generations.get(documentId) !== epoch) return;
      if (text !== undefined) parked.set(documentId, text);
      committed = true;
    })();
    // Waiters settle on `done`, not on `work`: when the engine dies, `work`
    // pends forever on the terminated worker, and the loss path settles `done`
    // via `abandon()` instead. Racing (rather than replacing) keeps the normal
    // path's outcome — including a `free` failure — while a late settlement
    // after abandon still runs the generation check above, so it frees but
    // never commits over the replacement.
    let releaseWaiters!: () => void;
    const abandoned = new Promise<void>((resolve) => {
      releaseWaiters = resolve;
    });
    const inFlight: InFlightPark = {
      done: Promise.race([work, abandoned]),
      abandon: () => releaseWaiters(),
      engine: entry.document.kind.engine ?? null,
    };
    parksInFlight.set(documentId, inFlight);
    try {
      await inFlight.done;
    } finally {
      if (parksInFlight.get(documentId) === inFlight) parksInFlight.delete(documentId);
    }
    if (committed) emit({ type: 'parked', documentId, reason, recoverable: parked.has(documentId) });
  }

  /**
   * A live handle for a document, hydrating from parked text if needed.
   *
   * Creates a fresh document the first time an id is seen, which is what makes
   * "open a new tab" and "restore a tab from a file" the same call.
   */
  async function acquire(document: RegisteredDocument): Promise<number> {
    const existing = hot.get(document.id);
    if (existing) {
      existing.touched = clock += 1;
      return existing.handle;
    }
    // A park is serializing this document: its hot entry is already gone but
    // its fresh text is not parked yet. Waiting and re-reading hydrates from
    // that text; proceeding would mint a blank handle — or a stale one from
    // the text being replaced — that `serialize()`'s hot-first rule then
    // prefers over the fresh text until the next park makes it permanent.
    const parking = parksInFlight.get(document.id);
    if (parking) {
      await parking.done;
      return acquire(document);
    }

    const text = parked.get(document.id);
    const handle =
      text === undefined
        ? await document.kind.codec.create()
        : await document.kind.codec.hydrate(text);

    hot.set(document.id, { document, handle, touched: (clock += 1) });
    // The parked text is deliberately *kept*, not consumed. It is the last known
    // good state, and it is the only thing standing between an engine crash and
    // losing the document outright — dropping it here would mean a document that
    // had been parked once could still become unrecoverable simply by being
    // looked at again. Cost is the text staying resident for at most `hotLimit`
    // documents; `park` overwrites it with something fresher.
    emit({ type: 'hydrated', documentId: document.id, handle });
    // After insertion, so the newly hydrated document counts toward the budget
    // and cannot itself be chosen as the victim.
    await evictIfNeeded(document.id);
    return handle;
  }

  /**
   * Hold a document hot for the duration of `work`.
   *
   * Wrap anything long-running — an optimize, a fold, a build — so a tab switch
   * during it cannot evict the handle being written to (see the plan's R14).
   */
  async function pinned<T>(document: RegisteredDocument, work: (handle: number) => Promise<T>): Promise<T> {
    // Pin *before* hydrating, not after: `acquire` suspends, and anything that runs
    // while it is suspended could otherwise evict the document this call exists
    // to protect.
    pins.set(document.id, (pins.get(document.id) ?? 0) + 1);
    try {
      const handle = await acquire(document);
      return await work(handle);
    } finally {
      const remaining = (pins.get(document.id) ?? 1) - 1;
      if (remaining > 0) pins.set(document.id, remaining);
      else pins.delete(document.id);
    }
  }

  /** Serialized text for a document, parking it first if it is hot. */
  async function serialize(document: RegisteredDocument): Promise<string> {
    // A park in flight means the hot entry is gone but its replacement text is
    // not parked yet: answering now would return the stale text being replaced
    // — or throw when nothing was ever parked — while the fresh text lands a
    // moment later. Wait for it instead.
    await parksInFlight.get(document.id)?.done;
    const entry = hot.get(document.id);
    if (entry) return entry.document.kind.codec.serialize(entry.handle);
    const text = parked.get(document.id);
    if (text !== undefined) return text;
    throw new Error(`Document ${document.id} is not registered`);
  }

  /** Adopt a document the registry has not seen, from text (e.g. loading a file). */
  function adopt(documentId: string, text: string): void {
    // Invalidates any park serializing the previous occupant: its text must not
    // overwrite the adopted one when it finishes.
    bumpGeneration(documentId);
    parked.set(documentId, text);
  }

  /**
   * Take ownership of a handle the caller already created.
   *
   * The live-handle counterpart of {@link adopt}. Some engine calls build a
   * document and hand back a handle directly — `newDesign`, `loadTmd` — and a
   * caller holding one had nowhere to put it. Left outside, the registry would
   * create a *second*, blank document the first time anything acquired that id:
   * the real one leaks, the design is silently replaced by an empty one, and
   * `serialize` throws because nothing is registered under that id at all.
   *
   * Replaces whatever the document held, freeing the old handle. The parked text
   * goes with it — it describes the document being replaced, so keeping it would
   * make a later crash recover the wrong content rather than none.
   */
  async function adoptHandle(document: RegisteredDocument, handle: number): Promise<void> {
    // First, synchronously: an in-flight park for the previous occupant is stale
    // from here on — it may still free its own handle, but never commit.
    bumpGeneration(document.id);
    const existing = hot.get(document.id);
    hot.set(document.id, { document, handle, touched: (clock += 1) });
    parked.delete(document.id);
    if (existing && existing.handle !== handle) {
      await existing.document.kind.codec.free(existing.handle);
    }
    emit({ type: 'hydrated', documentId: document.id, handle });
    await evictIfNeeded(document.id);
  }

  /** Drop a document entirely — closing its tab. Frees any live handle. */
  async function forget(documentId: string): Promise<void> {
    // First, synchronously: an in-flight park for this document is stale from
    // here on — it may still free its own handle, but must not resurrect text.
    bumpGeneration(documentId);
    const entry = hot.get(documentId);
    if (entry) {
      hot.delete(documentId);
      await entry.document.kind.codec.free(entry.handle);
    }
    parked.delete(documentId);
  }

  /**
   * An engine died: every handle it held is invalid. Drop them without trying to
   * serialize or free — both would call the dead client and hang — and keep the
   * last parked text so the documents can be rehydrated once it respawns.
   */
  const handleEngineLost = (engine: EngineId) => {
    // A park serializing on the dead engine can never finish: its worker is
    // gone, so the Comlink promise it awaits pends forever — along with every
    // `acquire()`/`serialize()`/`park()` waiting on the tracked entry. Abandon
    // those entries synchronously so waiters proceed from the last parked text
    // without depending on the terminated worker answering. The bump keeps a
    // late settlement from committing over the replacement, exactly like any
    // other ownership change mid-park.
    for (const [documentId, inFlight] of [...parksInFlight]) {
      if (inFlight.engine === null || inFlight.engine !== engine) continue;
      bumpGeneration(documentId);
      parksInFlight.delete(documentId);
      inFlight.abandon();
      // Documents with a live handle are reported by the loop below; report
      // here only the ones it cannot see — their hot entry is already gone.
      const live = hot.get(documentId);
      if (!live || live.document.kind.engine !== engine) {
        emit({
          type: 'parked',
          documentId,
          reason: 'engine-lost',
          recoverable: parked.has(documentId),
        });
      }
    }
    for (const entry of [...hot.values()]) {
      // A kind with no engine has no engine death to survive.
      if (entry.document.kind.engine === null || entry.document.kind.engine !== engine) continue;
      // The live handle is gone: any park still serializing an older handle for
      // this document is stale from here on.
      bumpGeneration(entry.document.id);
      hot.delete(entry.document.id);
      // Whatever text was captured at the last park stands. A document that was
      // never parked has none, and `recoverable: false` says so rather than
      // inventing an empty document for the caller to hydrate from.
      emit({
        type: 'parked',
        documentId: entry.document.id,
        reason: 'engine-lost',
        recoverable: parked.has(entry.document.id),
      });
    }
  };

  const subscribe = options.subscribeToEngineLoss ?? onEngineLost;
  const stopListening = subscribe(({ engine }) => handleEngineLost(engine));

  return {
    acquire,
    park,
    pinned,
    serialize,
    adopt,
    adoptHandle,
    forget,
    /** Ids with a live handle, most-recently-used last. Diagnostics and tests. */
    hotIds: (): string[] =>
      [...hot.values()].sort((a, b) => a.touched - b.touched).map((entry) => entry.document.id),
    isHot: (documentId: string): boolean => hot.has(documentId),
    handleFor: (documentId: string): number | null => hot.get(documentId)?.handle ?? null,
    subscribe: (listener: (event: DocumentRegistryEvent) => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Stop reacting to engine loss. For tests and teardown. */
    dispose: stopListening,
  };
}

export type DocumentRegistry = ReturnType<typeof createDocumentRegistry>;
