/**
 * An asynchronous workspace action can hold an old snapshot between an engine
 * call and its final store write. A document replacement must not land inside
 * that interval. Counting at the store boundary covers nested actions, file
 * loads, undo, optimizers and folds without changing their existing semantics.
 * Synchronous viewport/selection actions need no lock: commit's compare-and-swap
 * and store publication run together in one JavaScript turn.
 */
let pending = 0;
export function workspaceOperationsIdle(): boolean { return pending === 0; }

export function fenceWorkspaceActions<T extends object>(slice: T): T {
  const result = { ...slice };
  for (const key of Object.keys(result) as (keyof T)[]) {
    if (key === 'commitCpExperiment' || key === 'publishDesignExperiment') continue;
    const action = result[key];
    if (typeof action !== 'function') continue;
    result[key] = ((...args: unknown[]) => {
      const value: unknown = action(...args);
      if (value && typeof value === 'object' && 'then' in value && typeof value.then === 'function') {
        pending += 1;
        return Promise.resolve(value).finally(() => { pending -= 1; });
      }
      return value;
    }) as T[keyof T];
  }
  return result;
}
