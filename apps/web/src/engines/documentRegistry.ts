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
 * on screen. It maps document id -> handle, qualified by the engine generation
 * that minted the handle: a bare number is meaningless across workers, so the
 * pair is the identity (see [I11] below).
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
   * How many engine-generation recoveries one `acquire()` survives before it
   * fails loudly [I12]. A recovery is a dropped dead-generation handle or an
   * abandoned create/hydrate whose RPC straddled a loss — never a park-settle
   * wait or a plain re-read. Three by default: one transient loss recovers on
   * the first retry, a flaky restart on the second, and an engine that cannot
   * stay up for a single RPC surfaces instead of hanging its caller (and its
   * caller's `historyBusy`) forever.
   */
  maxEngineRecoveryAttempts?: number;
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
  /**
   * Engine that minted `handle`, and its generation at the time [I11].
   *
   * Null for kinds with no engine, which have no worker whose death could
   * invalidate anything.
   */
  engine: EngineId | null;
  engineEpoch: number;
}
export const DEFAULT_MAX_ENGINE_RECOVERY_ATTEMPTS = 3;

/**
 * `serialize()` found neither a live handle nor parked text: the design was
 * never materialized under this id. The save pipeline maps exactly this to
 * "skip it" — every other failure propagates.
 */
export class DocumentNotRegisteredError extends Error {
  readonly documentId: string;
  constructor(documentId: string) {
    super(`Document ${documentId} is not registered`);
    this.name = 'DocumentNotRegisteredError';
    this.documentId = documentId;
  }
}

/**
 * A `serialize()` RPC answered, but the document's semantic ownership moved
 * while it pended (`adopt`, `adoptHandle`, `forget`) — so the bytes describe
 * a document that no longer exists. Thrown instead of answering from older
 * parked text (a silent downgrade) or from the replacement (masking the
 * race): the caller re-addresses the current document.
 */
export class DocumentOwnershipChangedError extends Error {
  readonly documentId: string;
  constructor(documentId: string) {
    super(
      `Document ${documentId} changed ownership during a registry operation; the in-flight result was discarded`
    );
    this.name = 'DocumentOwnershipChangedError';
    this.documentId = documentId;
  }
}

/**
 * One `acquire()` observed more engine generations die than
 * {@link DocumentRegistryOptions.maxEngineRecoveryAttempts} allows. Thrown so
 * an operation under engine churn (an undo holding `historyBusy`) fails
 * loudly instead of reconnecting forever.
 */
export class EngineRecoveryExhaustedError extends Error {
  readonly documentId: string;
  readonly attempts: number;
  constructor(documentId: string, attempts: number) {
    super(`Engine recovery exhausted after ${attempts} attempts (document ${documentId})`);
    this.name = 'EngineRecoveryExhaustedError';
    this.documentId = documentId;
    this.attempts = attempts;
  }
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
  const maxEngineRecoveryAttempts =
    options.maxEngineRecoveryAttempts ?? DEFAULT_MAX_ENGINE_RECOVERY_ATTEMPTS;
  const hot = new Map<string, HotEntry>();
  /** Serialized text for every document the registry has parked. */
  const parked = new Map<string, string>();
  /**
   * Semantic ownership revision per document id [I12].
   *
   * Bumped only when the document itself is replaced — `adopt`, `adoptHandle`,
   * `forget` — never on a park, an acquisition, or a mere engine death. It is
   * what lets `serialize` tell "my worker died under a valid read" (usable)
   * from "the document I read no longer exists" (failure): the coarse
   * `generations` clock moves on both, this one only on the second.
   */
  const ownershipRevisions = new Map<string, number>();
  const ownershipRevision = (documentId: string): number =>
    ownershipRevisions.get(documentId) ?? 0;
  const bumpOwnership = (documentId: string): void => {
    ownershipRevisions.set(documentId, ownershipRevision(documentId) + 1);
  };
  /**
   * Write sequence per document id, bumped on every `parked` store. A verified
   * `serialize` refreshes last-known-good only while the sequence it saw at
   * dispatch still holds — so a park commit racing the read always wins.
   * Hydration captures the same sequence: an engine-current result must not
   * shadow a newer snapshot published while its materialization was pending.
   */
  const parkedSequences = new Map<string, number>();
  const parkedSequence = (documentId: string): number => parkedSequences.get(documentId) ?? 0;
  const setParked = (documentId: string, text: string): void => {
    parked.set(documentId, text);
    parkedSequences.set(documentId, parkedSequence(documentId) + 1);
  };
  const deleteParked = (documentId: string): void => {
    parked.delete(documentId);
    parkedSequences.delete(documentId);
  };
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
   * Ownership / park state-machine invariants. Every choice below traces to one.
   *
   * [I1 hot handle] At most one live handle per document. Removing the hot
   *   entry transfers cleanup duty to exactly one park (or to `forget` /
   *   `adoptHandle`'s direct free) — never zero, never two. A dead generation
   *   discharges the duty by abandon instead [I11].
   * [I2 parked snapshot] `parked` holds the freshest text whose generation is
   *   current. A current-epoch park commit, `adopt`, or a verified `serialize`
   *   refresh overwrites it; only `adoptHandle` / `forget` delete it. Nothing
   *   resurrects deleted text.
   * [I3 in-flight park] A park whose hot entry is gone but whose text is not
   *   parked yet is recorded in `parksInFlight` — at most one waiter-visible
   *   record per document. Waiters await `done`, never a worker RPC directly.
   * [I4 generation] Bumped synchronously on every ownership/state change (park
   *   start, `adopt`, `adoptHandle`, `forget`, engine-loss drop). A park frees
   *   its own handle while its engine generation is still current [I11], but
   *   commits text only while its epoch is current — checked at serialize time
   *   AND at settle time.
   * [I5 early commit] A successful serialization whose generation is still
   *   current becomes last-known-good BEFORE the potentially-hanging `free`:
   *   a cleanup hang, failure, or loss must never discard serialized content.
   * [I6 waiter lifetime] Every waiter-visible record settles — normally via
   *   work completion, early via `abandon` on supersede or engine loss.
   *   Records are never dropped without settling their waiters.
   * [I7 supersede retires] `adopt` / `adoptHandle` / `forget` / a newer park
   *   synchronously retire the obsolete record (abandon + remove) while its
   *   worker RPCs finish or hang untracked — cleanup-while-current [I11] but
   *   never commit. No document accumulates multiple live waiter records.
   * [I8 engine loss] Drops live handles without touching the dead worker,
   *   abandons tracked parks synchronously, and bumps generations so late
   *   settlements never commit. Cleanup of dead-generation handles is skipped
   *   [I11] — the worker took them with it. Early-committed text stands as the
   *   recovery; a never-parked document stays unrecoverable (nothing invented).
   * [I9 transfer] `adopt` / `adoptHandle` / `forget` apply synchronously —
   *   bump, retire, then update hot/parked — before any await, so no waiter
   *   observes a half-moved document.
   * [I10 cleanup] Every removed hot handle whose engine generation is still
   *   current is freed exactly once; `free` errors are logged and never
   *   un-commit text nor fail waiters. Handles of a dead generation are dropped
   *   without cleanup — freeing them through the replacement could kill an
   *   unrelated document reusing the number. Finalization deletes only its own
   *   record, never a newer one.
   * [I11 handle provenance] A hot handle is valid only with its minting engine
   *   generation: every worker numbers its own handles from scratch, so a bare
   *   number is meaningless across generations. Every hot entry records minter
   *   and epoch; `handleEngineLost` advances the epoch. Every engine RPC
   *   resolves its client once per operation and binds to it — the epoch is
   *   captured after the resolution, never before, because a connect pending
   *   across a loss resolves to the replacement whose result is live. Same
   *   generation still implies the same engine (generations advance on every
   *   replacement while the client stays memoized), so a post-resolution
   *   capture that still matches at completion proves the result came from the
   *   live engine: `acquire` inserts it, cleanups run it. A mismatch means the
   *   RPC spanned a loss — abandon without cleanup and recover (retry the
   *   acquisition, skip the free). Hot hits need no RPC and validate the stamp
   *   directly. `serialize` is the exception that proves the rule [I12]: its
   *   result is text, not a handle, so a read dispatched against the correct
   *   owner stays usable past a loss while ownership holds.
   * [I12 semantic ownership] The per-document ownership revision moves only on
   *   a semantic replacement — `adopt`, `adoptHandle`, `forget` — never on a
   *   park, an acquisition, or a mere engine death. A `serialize` result is
   *   usable iff (i) its RPC was dispatched while its hot entry was still
   *   installed (so the bound client is the minter's, never the replacement's)
   *   and (ii) the ownership revision is unchanged at completion. Otherwise it
   *   throws `DocumentOwnershipChangedError` — never older parked text as
   *   success. A usable result from a direct read (no wait, no re-read) also
   *   refreshes last-known-good, unless a park commit landed first
   *   (sequence-guarded, so concurrent parks always win). Waiter re-reads
   *   return but never promote: their instant postdates the call.
   *   `acquire` counts actual engine-generation recoveries against
   *   `maxEngineRecoveryAttempts` and throws `EngineRecoveryExhaustedError`
   *   past it — park-settle waits and plain re-reads are not recoveries.
   * [I13 materialization provenance] Create/hydrate may enter hot only while
   *   engine epoch, semantic ownership, source snapshot sequence, and registry
   *   state still match. A concurrent winner is never overwritten. Current-
   *   engine discarded results are freed through their bound client; dead-
   *   generation results are abandoned [I11]. Snapshot refreshes retry without
   *   consuming the engine budget. Ownership changes reject materialization,
   *   including forget: retrying a forgotten id would create it anew. Park
   *   waiters that have not begun materializing may follow replacements [I7].
   */
  /**
   * Ownership generation per document id [I4].
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
   * Engine generation per engine id [I11].
   *
   * Advanced synchronously in `handleEngineLost`, before any entry is dropped:
   * from that point on, anything the dead worker still resolves belongs to an
   * older generation and must never enter — or leave — `hot` through the
   * replacement's client. Kinds with no engine (`engine: null`) have no worker
   * to die and always read epoch 0.
   */
  const engineEpochs = new Map<EngineId, number>();
  const engineEpoch = (engine: EngineId | null): number =>
    engine === null ? 0 : (engineEpochs.get(engine) ?? 0);
  /** Whether a hot entry's minter is still the live generation. */
  const isEntryCurrent = (entry: HotEntry): boolean =>
    entry.engine === null || entry.engineEpoch === engineEpoch(entry.engine);
  /**
   * A park currently serializing a document whose hot entry is already gone.
   *
   * Waiters await `done`, never the worker RPC directly: if the engine dies
   * mid-serialize, its Comlink promise pends forever, and `handleEngineLost`
   * settles `done` via `abandon()` instead so `acquire()`/`serialize()`/`park()`
   * proceed from the last parked text. A supersede (`adopt`, `adoptHandle`,
   * `forget`, a newer park) retires the record the same way [I7]. A late
   * settlement of the original work still runs its generation checks, so it
   * can free but never commit.
   */
  interface InFlightPark {
    /** Settles when the park commits — or when supersede / engine loss abandons it. */
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
  /**
   * Retire the waiter-visible park for a document whose ownership just moved
   * on [I7, I9]: abandon its waiters and drop the record so a newer park can
   * never be mistaken for it — and it can never strand waiters once
   * overwritten. The retired worker RPCs keep running untracked in the
   * background, where the generation checks still force free-but-never-commit.
   * No extra generation bump here: the caller already bumped for the ownership
   * change this retires against.
   */
  const retirePark = (documentId: string): void => {
    const inFlight = parksInFlight.get(documentId);
    if (!inFlight) return;
    parksInFlight.delete(documentId);
    inFlight.abandon();
  };
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
    // Wait-and-re-read [I6]: a second `park` racing an in-flight one waits for
    // it — that wait is what makes `await park()` mean the text is safely
    // parked. Re-read after the wait: an abandon (supersede [I7] or engine
    // loss [I8]) can release this wait WITHOUT committing — a replacement may
    // be hot (fall through and park it) or a newer park in flight (wait on
    // that one instead). Each wake observes a settled-or-removed record, so
    // the loop always makes progress toward quiescence.
    let entry = hot.get(documentId);
    while (!entry) {
      const parking = parksInFlight.get(documentId);
      if (!parking) return;
      await parking.done;
      entry = hot.get(documentId);
    }
    // [I11] A handle from a dead generation is neither serializable nor
    // freeable through the live client — its number may already name another
    // document there. Drop it and return: the dead worker took its handles
    // with it, so there is nothing to clean up, and whatever parked text
    // stands is the recovery.
    if (!isEntryCurrent(entry)) {
      hot.delete(documentId);
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
    // bumps the generation, and this park must then never commit. Its text
    // describes the document as it was when the park started.
    const epoch = bumpGeneration(documentId);
    // The minter generation alongside it [I11]: an engine loss after this
    // point strands the handle on a dead worker, and its number may be reused
    // by the replacement — so the cleanup below must be skipped, not run
    // through the live client.
    const minter = entry.document.kind.engine;
    const minterEpoch = engineEpoch(minter);
    // Retire-then-install [I7]: with synchronous retire on every ownership
    // change this slot is empty here, but a stale record must never be
    // orphaned by overwrite — its waiters would hang outside every loss and
    // abandon path. Retiring first keeps at most one live waiter record per
    // document, and the identity check in `finally` below still spares newer
    // records [I10].
    retirePark(documentId);
    // Marked before the awaits, alongside the removal: an `acquire` landing in
    // the serialize/free window must wait for this park and hydrate from the
    // text it stores — not mint a blank handle from nothing parked yet, or a
    // stale one from the text being replaced. Set synchronously here, so there
    // is no gap between the removal above and the marker for anyone to slip through.
    let committed = false;
    const work = (async () => {
      // Resolved once for the serialize [I11]: whichever client this settles
      // to serves the read. A foreign number space cannot commit — the epoch
      // checks below refuse it — so binding only decides hang-vs-answer here,
      // never correctness.
      const connectSerialize =
        minter === null ? undefined : entry.document.kind.codec.resolveClient;
      const serializeClient = connectSerialize === undefined ? undefined : await connectSerialize();
      let text: string | undefined;
      try {
        text = await entry.document.kind.codec.serialize(entry.handle, serializeClient);
      } catch (error) {
        // Serialization failed, so the last known text is all there is. Keeping it
        // loses the edits since, but dropping the entry entirely would lose the
        // document — and the handle still has to be freed either way, unless
        // its engine died with it [I11].
        console.error(`[ori-studio] failed to serialize document ${documentId}`, error);
      }
      // [I5] Publish last-known-good BEFORE the potentially-hanging cleanup:
      // once `serialize` has resolved, the text is recoverable even if `free`
      // below pends forever and an engine loss abandons this park. The epoch
      // check keeps a superseded park from committing over its replacement —
      // whichever lands last among this commit, `adopt`, `adoptHandle`, or
      // `forget` still wins, because each of those bumps first (see [I4]).
      if (text !== undefined && generations.get(documentId) === epoch) {
        setParked(documentId, text);
      }
      // Resolved once for the cleanup, checked after the resolution it
      // authorizes [I1, I10, I11]: this handle was removed from the hot set
      // above, so nobody else will free it — unless the minter itself died, in
      // which case the worker took its handles with it and the number may
      // already name another document on the replacement. Then the cleanup is
      // skipped, never run through the live client. A cleanup failure is
      // logged but never un-commits the text above and never fails `done`
      // below: waiters proceed from the committed text, and the park caller
      // resolves with the text safe.
      const connectFree =
        minter === null ? undefined : entry.document.kind.codec.resolveClient;
      const freeClient = connectFree === undefined ? undefined : await connectFree();
      if (minter === null || engineEpoch(minter) === minterEpoch) {
        try {
          await entry.document.kind.codec.free(entry.handle, freeClient);
        } catch (error) {
          console.error(`[ori-studio] failed to free document ${documentId}`, error);
        }
      }
      if (generations.get(documentId) !== epoch) return;
      if (text !== undefined) setParked(documentId, text);
      committed = true;
    })();
    // Waiters settle on `done`, not on `work`: when the engine dies, `work`
    // pends forever on the terminated worker, and the loss path settles `done`
    // via `abandon()` instead. `work` itself never rejects — serialize and
    // cleanup failures are logged above [I10] — so `done` only settles by
    // completion or abandon, never by throwing at waiters. A late settlement
    // after abandon still runs the generation checks above, so it never
    // commits over the replacement — and skips its cleanup past an engine
    // loss [I11] instead of freeing through the replacement's client.
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
   *
   * Every pass re-reads hot and the in-flight parks: a result that resolves
   * after the world moved — a park landing, an engine dying — must never
   * overwrite the replacement [I11].
   */
  async function acquire(document: RegisteredDocument): Promise<number> {
    // Recoveries observed by THIS call [I12]: each engine generation that dies
    // under it is one retry. Park-settle waits and plain re-reads below are
    // not recoveries and never touch this count.
    let ownershipAtStart: number | undefined;
    const assertOwnership = (): void => {
      if (ownershipAtStart !== undefined && ownershipRevision(document.id) !== ownershipAtStart) {
        throw new DocumentOwnershipChangedError(document.id);
      }
    };
    let recoveryAttempts = 0;
    const noteEngineRecovery = (): void => {
      recoveryAttempts += 1;
      if (recoveryAttempts > maxEngineRecoveryAttempts) {
        throw new EngineRecoveryExhaustedError(document.id, recoveryAttempts);
      }
    };
    for (;;) {
      assertOwnership();
      const existing = hot.get(document.id);
      if (existing) {
        if (isEntryCurrent(existing)) {
          existing.touched = clock += 1;
          return existing.handle;
        }
        // A dead generation's number, which the replacement engine may already
        // have reused for another document. Drop it without cleanup — freeing
        // through the live client could kill that document — and recover below.
        hot.delete(document.id);
        noteEngineRecovery();
        continue;
      }
      // A park is serializing this document: its hot entry is already gone but
      // its fresh text is not parked yet. Waiting and re-reading hydrates from
      // that text; proceeding would mint a blank handle — or a stale one from
      // the text being replaced — that `serialize()`'s hot-first rule then
      // prefers over the fresh text until the next park makes it permanent.
      const parking = parksInFlight.get(document.id);
      if (parking) {
        const beforeWait = ownershipRevision(document.id);
        await parking.done;
        // Park waiters may follow an adopted replacement, as before [I7].
        // Forget with no replacement must not turn that waiter into create().
        if (ownershipRevision(document.id) !== beforeWait &&
            !hot.has(document.id) && !parked.has(document.id)) {
          throw new DocumentOwnershipChangedError(document.id);
        }
        continue;
      }

      ownershipAtStart ??= ownershipRevision(document.id);
      // The owning client, resolved once for this attempt [I11]. The epoch is
      // captured after the resolution it is bound to — never before. A connect
      // pending across a loss resolves to the replacement, and its result is
      // live: capturing before resolution would abandon it and retry (leaking
      // a live handle and doubling the RPC). Same generation still implies the
      // same engine — generations advance on every replacement while the
      // client stays memoized — so a post-resolution capture that still matches
      // at completion proves the result came from the live engine. A genuinely
      // late result (RPC sent pre-loss) still mismatches and is abandoned.
      // No hop when there is nothing to resolve: kinds with no engine, and
      // codecs without a client factory, answer synchronously in the same
      // drain, so the capture below doubles as the pre-call one for them —
      // and awaiting anything here would reorder their waiters behind
      // already-queued continuations.
      const engine = document.kind.engine;
      const connect = engine === null ? undefined : document.kind.codec.resolveClient;
      const client = connect === undefined ? undefined : await connect();
      assertOwnership();
      // Resolution can yield to a competing acquire or park. Re-read before
      // dispatch, not just after hydration, so neither can be overwritten.
      if (hot.has(document.id) || parksInFlight.has(document.id)) continue;
      const epochAtResolution = engineEpoch(engine);
      const sequenceAtDispatch = parkedSequence(document.id);
      const stateAtDispatch = generations.get(document.id);
      const text = parked.get(document.id);
      const handle =
        text === undefined
          ? await document.kind.codec.create(client)
          : await document.kind.codec.hydrate(text, client);
      if (engine !== null && engineEpoch(engine) !== epochAtResolution) {
        // Straddled a loss: abandon without cleanup (never hot.set, never
        // free — the number may name another document on the live engine)
        // and retry on the current generation, within budget.
        noteEngineRecovery();
        continue;
      }

      if (
        ownershipRevision(document.id) !== ownershipAtStart ||
        parkedSequence(document.id) !== sequenceAtDispatch ||
        generations.get(document.id) !== stateAtDispatch ||
        hot.has(document.id)
      ) {
        // No await between the epoch check and dispatch: this client still
        // owns the discarded handle. Never resolve a replacement for cleanup.
        try {
          await document.kind.codec.free(handle, client);
        } catch (error) {
          console.error(`[ori-studio] failed to free stale hydration ${document.id}`, error);
        }
        assertOwnership();
        continue;
      }
      const installed = { document, handle, touched: (clock += 1), engine, engineEpoch: epochAtResolution };
      hot.set(document.id, installed);
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
      assertOwnership();
      if (!isEntryCurrent(installed)) {
        noteEngineRecovery();
        continue;
      }
      if (hot.get(document.id) !== installed) continue;
      return handle;
    }
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
    // moment later. Wait for it instead — but only when one is actually in
    // flight: awaiting unconditionally yields a microtask even with no park
    // present, so a `park()` landing synchronously after this call used to win
    // the race and this read the old parked text (or threw) instead of the
    // live handle it was called on. Re-read after the wait either way: the
    // world moved while suspended.
    //
    // `direct` tracks whether this call has yet to wait or re-read [I12]:
    // only a read dispatched straight at the live document promotes its
    // result to last-known-good. A waiter re-reading after a park, a loss, or
    // a replacement answers a later instant than the one it was called on —
    // returning that text is fine, but parking it would let post-replacement
    // content silently become the recovery (and defeat `adoptHandle`'s
    // deliberate drop of the replaced text).
    let direct = true;
    for (;;) {
      const parking = parksInFlight.get(document.id);
      if (parking) {
        await parking.done;
        direct = false;
        continue;
      }
      const entry = hot.get(document.id);
      if (!entry) break;
      // [I11] A dead generation's number may already name another document on
      // the live engine: never read through it. Drop it and re-read — the
      // last parked text (or the honest `not registered` below).
      if (!isEntryCurrent(entry)) {
        hot.delete(document.id);
        direct = false;
        continue;
      }
      // Bound to the minter's generation like `acquire` [I11]: the RPC runs on
      // the client this resolution returned, so the entry must still be
      // installed when it is sent — a loss, park start, `adoptHandle`, or
      // `forget` during the resolution moved it, and this handle's number
      // through the replacement's client would read a foreign document.
      // Re-read instead, never send. No hop when there is nothing to resolve
      // (same-drain synchronous codecs keep their exact waiter timing).
      const engine = entry.engine;
      const connect = engine === null ? undefined : entry.document.kind.codec.resolveClient;
      const client = connect === undefined ? undefined : await connect();
      if (hot.get(document.id) !== entry) {
        direct = false;
        continue;
      }
      // Ownership and parked sequence at dispatch [I12]: the RPC below is
      // addressed to this document generation.
      const ownershipAtDispatch = ownershipRevision(document.id);
      const parkedSeqAtDispatch = parkedSequence(document.id);
      // RPC failures propagate unchanged: only a superseded document discards
      // a successful read, never an engine error.
      const text = await entry.document.kind.codec.serialize(entry.handle, client);
      const current = hot.get(document.id);
      if (current !== undefined && current !== entry) {
        // Another handle was installed for this id while the read pended. A
        // pure engine recovery rehydrated New from the same ownership: answer
        // from it. A semantic replacement (`adoptHandle`) changed ownership:
        // the bytes describe a superseded document — fail, never answer.
        if (ownershipRevision(document.id) !== ownershipAtDispatch) {
          throw new DocumentOwnershipChangedError(document.id);
        }
        direct = false;
        continue;
      }
      if (ownershipRevision(document.id) !== ownershipAtDispatch) {
        // `adopt` replaced the text, or `forget` deleted the document, while
        // the read pended. The bytes are not this document's: fail rather
        // than resurrecting them or answering older parked text as success.
        throw new DocumentOwnershipChangedError(document.id);
      }
      // Verified [I12]: dispatched against the owning handle/client with
      // ownership intact — so a loss in between does not invalidate these
      // bytes (they are text, not a handle). A direct read also publishes as
      // last-known-good unless a park commit landed first: its sequence
      // moved, and the concurrent park's read always wins over this one.
      if (direct && parkedSequence(document.id) === parkedSeqAtDispatch) {
        setParked(document.id, text);
      }
      return text;
    }
    const text = parked.get(document.id);
    if (text !== undefined) return text;
    throw new DocumentNotRegisteredError(document.id);
  }

  /** Adopt a document the registry has not seen, from text (e.g. loading a file). */
  function adopt(documentId: string, text: string): void {
    // Invalidates any park serializing the previous occupant: its text must not
    // overwrite the adopted one when it finishes [I4]. Retire its waiter-visible
    // record too [I7, I9] — synchronously, before the map updates below, so no
    // waiter observes a half-moved document and no overwritten record is left
    // for a later loss to miss.
    bumpGeneration(documentId);
    bumpOwnership(documentId);
    retirePark(documentId);
    setParked(documentId, text);
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
    // from here on — it may still free its own handle while its minter lives
    // [I11], but never commit [I4]. Retire its waiter-visible record as well
    // [I7, I9]: waiters migrate to the replacement on wake instead of hanging
    // on a record the next park would otherwise overwrite out from under them.
    bumpGeneration(document.id);
    bumpOwnership(document.id);
    retirePark(document.id);
    const existing = hot.get(document.id);
    // Stamped with the adopting generation [I11]: the caller proved the minter
    // alive with a same-client read immediately before this call (snapshot /
    // buildProjectState), and this install runs synchronously in the same
    // drain — so the adopted handle is of the current generation, and every
    // later loss stays honest about it.
    const engine = document.kind.engine;
    hot.set(document.id, { document, handle, touched: (clock += 1), engine, engineEpoch: engineEpoch(engine) });
    deleteParked(document.id);
    // The previous handle only while its own minter is still live: past a loss
    // it died with its worker, and freeing its number through the live client
    // could kill an unrelated document reusing it. Resolved before the check,
    // so a connect spanning a loss cannot smuggle the stale number onto the
    // replacement's client — the check authorizes the resolution, not a
    // pre-resolution guess.
    if (existing && existing.handle !== handle) {
      const previous = existing.document.kind;
      const connectFree = existing.engine === null ? undefined : previous.codec.resolveClient;
      const freeClient = connectFree === undefined ? undefined : await connectFree();
      if (isEntryCurrent(existing)) {
        await previous.codec.free(existing.handle, freeClient);
      }
    }
    emit({ type: 'hydrated', documentId: document.id, handle });
    await evictIfNeeded(document.id);
  }

  /** Drop a document entirely — closing its tab. Frees any live handle. */
  async function forget(documentId: string): Promise<void> {
    // First, synchronously: an in-flight park for this document is stale from
    // here on — it may still free its own handle, but must not resurrect text
    // [I4]. Retire its waiter-visible record as well [I7, I9]: second-park
    // waiters wake into the re-read loop and observe the deletion instead of
    // hanging on a record nothing will ever settle.
    bumpGeneration(documentId);
    bumpOwnership(documentId);
    retirePark(documentId);
    const entry = hot.get(documentId);
    if (entry) {
      hot.delete(documentId);
      // Only while its minter is still live [I11]: past a loss the handle died
      // with its worker, and freeing its number through the live client could
      // kill an unrelated document reusing it. Checked after resolution, like
      // every other cleanup — see `adoptHandle`.
      const connectFree =
        entry.engine === null ? undefined : entry.document.kind.codec.resolveClient;
      const freeClient = connectFree === undefined ? undefined : await connectFree();
      if (isEntryCurrent(entry)) {
        await entry.document.kind.codec.free(entry.handle, freeClient);
      }
    }
    deleteParked(documentId);
  }

  /**
   * An engine died: every handle it held is invalid. Drop them without trying to
   * serialize or free — both would call the dead client and hang — and keep the
   * last parked text so the documents can be rehydrated once it respawns.
   */
  const handleEngineLost = (engine: EngineId) => {
    // Advance first [I11]: from here on, anything the dead worker still
    // resolves is an older generation — late `acquire` results are abandoned
    // instead of inserted, and a handle this drop somehow misses is still
    // refused at every later use.
    engineEpochs.set(engine, engineEpoch(engine) + 1);
    // A park serializing on the dead engine can never finish: its worker is
    // gone, so the Comlink promise it awaits pends forever — along with every
    // `acquire()`/`serialize()`/`park()` waiting on the tracked entry. Abandon
    // those entries synchronously so waiters proceed from the last parked text
    // without depending on the terminated worker answering. The bump keeps a
    // late settlement from committing over the replacement, exactly like any
    // other ownership change mid-park. Every live waiter record is tracked here
    // [I7]: superseded records were already retired at the transition that
    // replaced them, so iterating the map abandons each outstanding waiter set
    // exactly once and no orphaned record can survive this loop.
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
