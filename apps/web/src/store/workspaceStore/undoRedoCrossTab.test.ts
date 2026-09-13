import { describe, expect, it, vi } from 'vitest';

/**
 * Undo/redo engine calls belong to the design that started them.
 *
 * `undoTree`/`redoTree` capture `designId` for the store write, but the engine
 * side resolved the *live* tab after its awaits: `ensureTreeHandle` re-read the
 * active design after `await getEngine()`, and `loadTreeFromText` adopted the
 * rebuilt handle into whichever slot was active at entry. A tab switch
 * mid-round-trip then (1) serialized the sibling's tree into the origin's
 * redo-future and (2) adopted the rebuilt handle into the sibling's registry
 * slot — freeing the sibling's handle and deleting its parked text.
 *
 * These tests execute the real routing code — the real `engineRuntime`
 * functions over the real `designHandles`/`documentRegistry`, with only the
 * worker boundary (`engineHost`) stubbed — and mirror `historySlice` undo
 * lines 390-400 step for step: capture the origin, flip the live tab
 * mid-flight, then run the engine call.
 */

vi.mock('../../engines/engineHost', () => ({
  connectEngine: (..._args: unknown[]) => mockConnect(),
  isEngineConnected: () => true,
  onEngineLost: () => () => undefined,
  getEngineGeneration: () => 0,
}));

// Set by each test before the (hoisted) mock module is used.
let mockConnect: () => Promise<unknown> = () =>
  Promise.reject(new Error('mockConnect not set'));

import { registerActiveDesignSource } from './activeDesignSource';
import {
  adoptDesignHandle,
  isDesignHot,
  serializeDesign,
} from '../../engines/designHandles';
import { ensureTreeHandle, loadTreeFromText } from './engineRuntime';

// Live-active pointer: the observable effect of `activateDesignTab`
// (projectSlice sets `activeDesignId`; the registered source reads it).
let active: { id: string; kind: string | null } = { id: 'none', kind: null };
registerActiveDesignSource(() => ({ ...active }));

let run = 0;
const uid = (tag: string) => `undocrosstab-${tag}-${(run += 1)}`;

/** Enough of the worker API for the undo round trip, with a gated load. */
function makeFakeApi() {
  let nextHandle = 1000;
  const textByHandle = new Map<number, string>();
  const calls = {
    loadTmd: [] as string[],
    saveTmd5: [] as number[],
    snapshot: [] as number[],
    freeTree: [] as number[],
    newDesign: 0,
  };
  let releaseLoad: ((handle: number) => void) | null = null;
  const api = {
    loadTmd: (text: string) => {
      calls.loadTmd.push(text);
      return new Promise<number>((resolve) => {
        releaseLoad = resolve;
      });
    },
    loadTmdImmediate: async (text: string) => {
      calls.loadTmd.push(text);
      const h = nextHandle++;
      textByHandle.set(h, text);
      return h;
    },
    saveTmd5: async (handle: number) => {
      calls.saveTmd5.push(handle);
      return textByHandle.get(handle) ?? `text-of-${handle}`;
    },
    snapshot: async (handle: number) => {
      calls.snapshot.push(handle);
      return { handle } as never;
    },
    freeTree: async (handle: number) => {
      calls.freeTree.push(handle);
    },
    newDesign: async (_paper: unknown) => {
      calls.newDesign++;
      const h = nextHandle++;
      textByHandle.set(h, 'blank');
      return h;
    },
  };
  return {
    api,
    calls,
    textByHandle,
    releaseLoad: (handle: number) => releaseLoad?.(handle),
  };
}

describe('undo/redo across a mid-flight tab switch', () => {
  it('serializes the origin design for the redo-future, not the sibling', async () => {
    const fake = makeFakeApi();
    mockConnect = async () => fake.api;
    const origin = uid('A');
    const sibling = uid('B');

    // Both tabs hold live trees with known content, via the real adopt path.
    active = { id: origin, kind: 'treemaker' };
    const hOrigin = await fake.api.loadTmdImmediate('A-TEXT');
    expect(await adoptDesignHandle(origin, 'treemaker', hOrigin)).toBe(true);
    active = { id: sibling, kind: 'treemaker' };
    const hSibling = await fake.api.loadTmdImmediate('B-TEXT');
    expect(await adoptDesignHandle(sibling, 'treemaker', hSibling)).toBe(true);

    // historySlice undoTree captures designId = origin, then suspends in
    // `await ensureTreeHandle()` -> `await getEngine()`.
    active = { id: origin, kind: 'treemaker' };
    const pending = ensureTreeHandle(origin);
    // Synchronous mid-flight switch, before any continuation resumes.
    active = { id: sibling, kind: 'treemaker' };
    const { api, treeHandle } = await pending;

    // The handle must be the origin's: the next undo step serializes it into
    // the origin's redo-future. The sibling's tree here is the poison bytes.
    expect(treeHandle).toBe(hOrigin);
    await expect(api.saveTmd5(treeHandle)).resolves.toBe('A-TEXT');
  });

  it('installs the rebuilt tree on the origin design, not the live tab', async () => {
    const fake = makeFakeApi();
    mockConnect = async () => fake.api;
    const origin = uid('C');
    const sibling = uid('D');

    // The sibling holds a live tree; the origin id was captured before the
    // undo's awaits (historySlice line 390).
    active = { id: sibling, kind: 'treemaker' };
    const hSibling = await fake.api.loadTmdImmediate('D-TEXT');
    expect(await adoptDesignHandle(sibling, 'treemaker', hSibling)).toBe(true);
    const designId = origin;

    // The awaits elapse and the user is on the sibling when undo calls
    // loadTreeFromText(engine, previous.text).
    active = { id: sibling, kind: 'treemaker' };
    const fresh = 4000 + run;
    fake.textByHandle.set(fresh, 'C-UNDO-TEXT');
    const pending = loadTreeFromText(fake.api as never, 'C-UNDO-TEXT', designId);
    fake.releaseLoad(fresh);
    const snapshot = await pending;

    // The rebuilt content is correct, and the registry owns the fresh handle
    // under the origin — while the sibling keeps its own tree.
    expect(snapshot).toEqual({ handle: fresh });
    expect(isDesignHot(origin)).toBe(true);
    expect(isDesignHot(sibling)).toBe(true);
    expect(fake.calls.freeTree).not.toContain(hSibling);
    await expect(serializeDesign(origin, 'treemaker')).resolves.toBe('C-UNDO-TEXT');
    await expect(serializeDesign(sibling, 'treemaker')).resolves.toBe('D-TEXT');
  });

  it('leaves addressing alone when no tab switch happens', async () => {
    const fake = makeFakeApi();
    mockConnect = async () => fake.api;
    const origin = uid('E');

    active = { id: origin, kind: 'treemaker' };
    const { treeHandle } = await ensureTreeHandle(origin);
    expect(typeof treeHandle).toBe('number');

    const pending = loadTreeFromText(fake.api as never, 'E-UNDO-TEXT', origin);
    const fresh = 5000 + run;
    fake.releaseLoad(fresh);
    await pending;
    expect(isDesignHot(origin)).toBe(true);
  });
});
