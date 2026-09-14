import type { TreeEdit, TreeSnapshot } from '../engine/types';
import type { DesignData } from './contracts';

interface SearchEngine {
  loadTmd(text: string): Promise<number>;
  snapshot(handle: number): Promise<TreeSnapshot>;
  applyEdit(handle: number, edit: TreeEdit): Promise<unknown>;
  optimizeScale(handle: number): Promise<unknown>;
  buildCreasePattern(handle: number): Promise<TreeSnapshot>;
  saveTmd5(handle: number): Promise<string>;
  freeTree(handle: number): Promise<void>;
}
export interface LayoutCandidate {
  trial: number;
  data: DesignData;
  summary: TreeSnapshot['summary'];
  cp_status: TreeSnapshot['cp_status_report'];
  feasible_leaf_paths: number;
  leaf_paths: number;
}

/** Numerical exploration only: every trial reloads the same tree, paper,
 * lengths, root and conditions. Symmetry is neither imposed nor rewarded. */
export async function searchLayouts(api: SearchEngine, text: string, options: { trials: number; keep: number; seed: number }, signal: AbortSignal) {
  let seed = options.seed >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const candidates: LayoutCandidate[] = [];
  const failures: { trial: number; code: string }[] = [];
  for (let trial = 0; trial < options.trials; trial += 1) {
    signal.throwIfAborted();
    const h = await api.loadTmd(text);
    try {
      const initial = await api.snapshot(h);
      if (trial > 0) {
        for (const node of initial.nodes.filter(n => !n.is_conditioned)) {
          signal.throwIfAborted();
          await api.applyEdit(h, { type: 'move_node', id: node.id, loc: {
            x: Math.max(0, Math.min(initial.paper.width, node.loc.x + (random() - 0.5) * initial.paper.width * 0.6)),
            y: Math.max(0, Math.min(initial.paper.height, node.loc.y + (random() - 0.5) * initial.paper.height * 0.6)),
          } });
        }
      }
      await api.optimizeScale(h);
      const built = await api.buildCreasePattern(h);
      const paths = built.paths.filter(p => p.is_leaf);
      const candidate: LayoutCandidate = { trial, data: { kind: 'treemaker', text: await api.saveTmd5(h) },
        summary: built.summary, cp_status: built.cp_status_report,
        leaf_paths: paths.length, feasible_leaf_paths: paths.filter(p => p.is_feasible).length };
      candidates.push(candidate);
      // Lexicographic, mechanical ordering. A buildable large base is not an
      // aesthetic winner; all retained alternatives still need visual review.
      candidates.sort((a, b) => Number(b.summary.cp_status === 'has_full_cp') - Number(a.summary.cp_status === 'has_full_cp') ||
        Number(b.summary.is_feasible) - Number(a.summary.is_feasible) || b.summary.scale - a.summary.scale || a.trial - b.trial);
      candidates.splice(options.keep);
    } catch (error) {
      signal.throwIfAborted();
      failures.push({ trial, code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'trial_failed' });
    } finally { await api.freeTree(h); }
  }
  return { result: { trials: options.trials, seed: options.seed, failures,
    candidates: candidates.map(({ data: _data, ...summary }, candidate_index) => ({ candidate_index, ...summary })),
    scope: 'Bounded initial-layout hypotheses for a fixed tree, paper and conditions. Ranked by full CP, feasibility, scale; visual quality is unjudged.',
    outcome: candidates.length ? 'alternatives_available' : 'no_candidate' }, candidates };
}
