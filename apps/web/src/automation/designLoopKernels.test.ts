import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it, vi } from 'vitest';
import type { Remote } from 'comlink';
import { initCpWasm } from '../engine/oristudioCpTestSupport';
import initTree from '../generated/treemaker-wasm/treemaker_wasm';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';
import type { TreemakerWorkerApi } from '../workers/treemakerWorker';
import { importDesign, exportFold } from './engines';
import { staticPose } from './pose';
import { poseView } from './poseRender';
import { poseFigure } from './posePublication';
import { exportDesign } from './export';
import { searchLayouts } from './layoutSearch';
import { sourceNodes } from './sourceProvenance';
import { parseNativeProjectFile } from '../lib/nativeProjectFile';
import { restoreProposal } from './proposalRestore';
import * as engines from './engines';
import { designPaper } from './paper';

const transport = vi.hoisted(() => ({ cp: null as unknown as OristudioCpWorkerApi, tree: null as unknown as TreemakerWorkerApi }));
vi.mock('comlink', async original => ({ ...await original<typeof import('comlink')>(), expose: (api: OristudioCpWorkerApi | TreemakerWorkerApi) => {
  if ('loadCp' in api) transport.cp = api; else transport.tree = api;
} }));
vi.mock('../engines/engineHost', async original => ({ ...await original<typeof import('../engines/engineHost')>(),
  connectEngine: async (kind: string) => kind === 'oristudio-cp' ? transport.cp : transport.tree,
}));
beforeAll(async () => {
  await initCpWasm(); await import('../workers/oristudioCpWorker');
  await initTree({ module_or_path: readFileSync(resolve(process.cwd(), 'src/generated/treemaker-wasm/treemaker_wasm_bg.wasm')) });
  await import('../workers/treemakerWorker');
});
const signal = () => new AbortController().signal;
const hinge = { vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'V'], edges_foldAngle: [0, 0, 0, 0, 90] };

it('poses actual CP geometry, maps face diagnostics to source creases, and saves a restartable figure without mutating the source', async () => {
  const data = await importDesign('crease_pattern', 'fold', JSON.stringify(hinge), 'Hinge');
  const before = structuredClone(data);
  const output = await staticPose(transport.cp as Remote<OristudioCpWorkerApi>, data, [{ line_id: 5, assignment: 'valley', angle: 70 }], 1, signal());
  expect(data).toEqual(before);
  expect(output.result).toMatchObject({ status: 'placed' });
  expect(output.pose?.face_line_ids).toHaveLength(2);
  expect(output.pose?.face_line_ids.every(ids => ids.includes(5))).toBe(true);
  const evaluation = poseView(output, 'isometric', false, []);
  const diagnostic = poseView(output, 'isometric', true, [5]);
  expect(evaluation.svg).not.toContain('>F1<');
  expect(diagnostic.svg).toContain('>F1<');
  expect(diagnostic.regions.every(region => region.line_ids.includes(5))).toBe(true);
  const adopted = output.proposedData!;
  expect(poseFigure(data, output, 'Wrong angles')).toBeUndefined();
  const figure = poseFigure(adopted, output, 'Hinge');
  expect(figure).toMatchObject({ handle: null, status: 'ready', sourceKind: 'generated-3d' });
  expect(figure?.renderSnapshot?.primitives.length).toBeGreaterThan(0);
  const exported = await exportDesign(data, 'Hinge', 'osf', undefined, output);
  const file = JSON.parse(String(exported.content));
  expect(() => parseNativeProjectFile(String(exported.content))).not.toThrow();
  expect(file.workspace.creasePattern.viewState.foldedFigures).toHaveLength(1);
  expect(file.workspace.creasePattern.viewState.foldedFigures[0].handle).toBeNull();
  const fold = JSON.parse(String((await exportDesign(data, 'Hinge', 'fold', undefined, output)).content));
  expect(fold.file_frames.some((frame: Record<string, unknown>) => frame['oristudio:folded3d'])).toBe(true);
});

it('refuses unassigned source structure rather than quietly omitting it from a static pose', async () => {
  const data = await importDesign('crease_pattern', 'fold', JSON.stringify({ ...hinge, edges_assignment: ['B', 'B', 'B', 'B', 'U'] }), 'Unassigned');
  await expect(staticPose(transport.cp as Remote<OristudioCpWorkerApi>, data, [], 1, signal())).rejects.toMatchObject({ code: 'unassigned_pose' });
  await expect(staticPose(transport.cp as Remote<OristudioCpWorkerApi>, data, [{ line_id: 1, assignment: 'valley', angle: 60 }], 1, signal())).rejects.toMatchObject({ code: 'invalid_reference' });
});

it('searches reproducible bounded TreeMaker layouts with actual optimizer/build and exact source anchors', async () => {
  const text = readFileSync(resolve(process.cwd(), '../../tests/fixtures/generated/triad-optimized.tmd5'), 'utf8');
  const options = { trials: 2, keep: 2, seed: 17 };
  const first = await searchLayouts(transport.tree, text, options, signal());
  const second = await searchLayouts(transport.tree, text, options, signal());
  expect(first).toEqual(second);
  expect(first.candidates.length).toBeGreaterThan(0);
  const h = await transport.tree.loadTmd(text);
  const original = await transport.tree.snapshot(h); await transport.tree.freeTree(h);
  for (const candidate of first.candidates) {
    expect(candidate.data.kind).toBe('treemaker');
    if (candidate.data.kind !== 'treemaker') continue;
    const handle = await transport.tree.loadTmd(candidate.data.text);
    const built = await transport.tree.snapshot(handle); await transport.tree.freeTree(handle);
    expect(built.paper.width).toBe(original.paper.width);
    expect(built.paper.height).toBe(original.paper.height);
    expect(built.conditions).toEqual(original.conditions);
    expect(built.edges.map(e => [e.id, e.length])).toEqual(original.edges.map(e => [e.id, e.length]));
    if (candidate.summary.cp_status === 'has_full_cp') {
      const fold = await exportFold(candidate.data);
      const cp = await importDesign('crease_pattern', 'fold', JSON.stringify(fold), 'Derived');
      const anchors = sourceNodes(fold, cp);
      expect(anchors?.length).toBeGreaterThan(0);
      expect(anchors?.every(anchor => original.nodes.some(node => node.id === anchor.id && node.is_leaf))).toBe(true);
    }
  }
}, 30_000);

it('restores the saved brief and captured source as historical context, then independently audits the source sheet', async () => {
  const text = readFileSync(resolve(process.cwd(), '../../tests/fixtures/generated/triad-optimized.tmd5'), 'utf8');
  const h = await transport.tree.loadTmd(text);
  await transport.tree.buildCreasePattern(h);
  const builtText = await transport.tree.saveTmd5(h); await transport.tree.freeTree(h);
  const sourceData = await importDesign('treemaker', 'tmd5', builtText, 'Source');
  const fold = await exportFold(sourceData);
  const cp = await importDesign('crease_pattern', 'fold', JSON.stringify(fold), 'CP');
  const brief = { goal: 'Preserve the three flaps', constraints: ['Keep lengths fixed'], paper: { shape: 'square' as const, sheets: 1 } };
  const report = { runs: [{ analysis: 'checks', status: 'completed', revision: 2 }] };
  const context = await restoreProposal({ version: 1, summary: { draft_id: 'previous', revision: 2, brief, evidence: report },
    source: { draft_id: 'tree', revision: 1, title: 'Source', data: sourceData, fold } }, cp, engines);
  expect(context.brief).toEqual(brief);
  expect(context.priorEvidence).toEqual(report);
  expect(context.source?.nodes?.length).toBeGreaterThan(0);
  expect(context.origin).toMatchObject({ draft_id: 'previous', revision: 2 });
  expect(await designPaper(sourceData, engines, brief.paper)).toMatchObject({ shape: 'square', contract_met: true, scope: expect.stringContaining('source-design sheet only') });
  await expect(restoreProposal({ version: 1, summary: { brief: { goal: 'changed', paper: { shape: 'circle', sheets: 1 } } } }, cp, engines)).rejects.toMatchObject({ code: 'invalid_arguments' });
});
