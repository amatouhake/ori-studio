/**
 * The agent guides under docs/mcp/ are derived from the knowledge base and are
 * served verbatim as MCP resources. They must only name tools, arguments,
 * operations and diagnostic labels that actually exist, and the operational
 * rules they state must match the catalog they describe. This test keeps
 * docs/mcp/{agent-prompt,diagnostics,recipes}.md honest against tools.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CONSTRUCTIONS, REPAIRS, TOOLS } from './tools';
import { GUIDANCE } from './service';

const docs = resolve(process.cwd(), '../../docs/mcp');
const read = (name: string) => readFileSync(resolve(docs, name), 'utf8');
const prompt = read('agent-prompt.md');
const diagnostics = read('diagnostics.md');
const recipes = read('recipes.md');
const guides = { prompt, diagnostics, recipes };
const knowledgeBase = readFileSync(resolve(process.cwd(), '../../docs/origami-design-knowledge.md'), 'utf8');
const skill = readFileSync(resolve(process.cwd(), '../../.agents/skills/ori-studio-origami-agent/SKILL.md'), 'utf8');

const toolNames = new Set(TOOLS.map(t => t.name));
const analyses = (TOOLS.find(t => t.name === 'analyze_design')!.inputSchema.properties as Record<string, { enum?: string[] }>).analysis.enum!;
const cpOps = CAPABILITIES.operations.edit_creases.map(op => op.type as string);
const treeOps = CAPABILITIES.operations.edit_tree.map(op => op.type as string);
const bpOps = CAPABILITIES.operations.edit_box_pleat.map(op => op.type as string);
const conditions = CAPABILITIES.operations.conditions.map(op => op.type as string);

/** Backticked identifiers that look like snake_case tool or operation names. */
const snakeIdentifiers = (text: string) =>
  [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:[ {:(]|`)/g)].map(m => m[1]);

// Identifiers the guides use that are result fields, kernel labels or KB
// names rather than callables; each is checked separately below or is a
// documented response field.
const KNOWN_RESULT_FIELDS = new Set([
  'draft_id', 'request_id', 'job_id', 'live_revision', 'load_serial', 'history_token', 'edit_revision',
  'fold_angle_degrees', 'residual_degrees', 'issue_count', 'checked_vertices', 'big_little_big', 'violation_color',
  'total_lines', 'line_ids', 'starting_face', 'case_limit', 'fold_amount', 'max_steps', 'solver_settled',
  'target_attainment', 'source_coverage', 'solution_count', 'estimation_step', 'contradiction_faces',
  'cp_status_report', 'is_feasible', 'old_scale', 'new_scale', 'bad_edges', 'bad_polys', 'bad_vertices',
  'bad_creases', 'bad_facets', 'stale_revision', 'no_local_issues', 'issues_found', 'has_full_cp',
  'edges_too_short', 'polys_not_valid', 'polys_not_filled', 'polys_multiple_ibps', 'vertices_lack_depth',
  'facets_not_valid', 'not_local_root_connectable', 'connect_to', 'edge_length', 'sym_loc', 'sym_angle',
  'has_symmetry', 'rotate_degrees', 'read_first', 'undo_label', 'design_id', 'checkpoint_id', 'settled_at_target',
  'moving_at_target', 'settled_without_target_attainment', 'step_limit_without_target_attainment',
  'simulation_diverged', 'fold_disconnected', 'export_loss_blocked', 'x_fixed', 'y_fixed', 'quant_offset', 'file_frames',
  'vertices_coords', 'edges_vertices', 'frame_classes', 'node1', 'node2', 'edge1', 'edge2', 'flap_ids',
  'box_pleat', 'crease_pattern', 'static_pose', 'include_source', 'from_source', 'candidate_index',
  'fold_is_flat', 'unassigned_pose', 'human_owned', 'paper_constraint_unmet', 'contract_met', 'job_timeout',
]);

describe('agent guides name only real tools, operations and labels', () => {
  it.each(Object.entries(guides))('%s: every snake_case identifier is a tool, operation, condition, analysis, repair or documented field', (_, text) => {
    const unknown = new Set<string>();
    for (const id of snakeIdentifiers(text)) {
      if (toolNames.has(id) || cpOps.includes(id) || treeOps.includes(id) || bpOps.includes(id) || conditions.includes(id)
        || analyses.includes(id) || id in REPAIRS || id in CONSTRUCTIONS || KNOWN_RESULT_FIELDS.has(id)) continue;
      unknown.add(id);
    }
    expect([...unknown]).toEqual([]);
  });

  it('the prompt names the default loop in catalog order and every guidance resource', () => {
    for (const name of ['workspace', 'begin_design', 'checkpoint_design', 'inspect_design', 'analyze_design', 'job_status', 'render_view', 'export_design', 'commit_design', 'discard_design']) {
      expect(prompt).toContain(`\`${name}\``);
    }
    for (const uri of GUIDANCE.resources) expect(prompt).toContain(uri);
    expect(prompt).toContain(GUIDANCE.read_first);
  });

  it('diagnostics cover every repair and every analysis the catalog offers', () => {
    for (const repair of Object.keys(REPAIRS)) expect(diagnostics).toContain(`\`${repair}\``);
    for (const analysis of analyses) expect(diagnostics + recipes).toContain(`"${analysis}"`);
  });

  it('diagnostics name fold errors by the code the engine surfaces, not the kernel variant', () => {
    // `CpSession` maps `FoldGraphError::DisconnectedFaces` to the code
    // `fold_disconnected`, and that code is all an agent ever sees in
    // `job_status`. The desktop crate's guidance tests pin this row against the
    // real mapping (`mcp/guidance.rs`); this keeps the web side from drifting.
    expect(diagnostics).toMatch(/\| error code `fold_disconnected` \|/);
    expect(diagnostics).not.toMatch(/error `DisconnectedFaces`/);
  });

  it('diagnostics cover every CheckCamv rule and colour label the kernel emits', () => {
    for (const rule of ['NumberOfFolds', 'Angles', 'Maekawa', 'BigLittleBig', 'None']) expect(diagnostics).toContain(`\`${rule}\``);
    for (const colour of ['NotEnoughMountain', 'NotEnoughValley', 'Equal', 'Correct', 'Unknown']) expect(diagnostics).toContain(`\`${colour}\``);
    for (const spatial of ['SpatialClosure', 'SpatialUndecided', 'SpatialUnknowable', 'SpatialInteriorBorder', 'SpatialSelfIntersection']) expect(diagnostics).toContain(`\`${spatial}\``);
    // Every spatial rule the kernel can emit (lib.rs spatial_closure_diagnostics / undecided / unknowable arms).
    for (const rule of ['Closure', 'Rigid', 'ClosureUnreachable', 'Undecided', 'UndecidedChoice', 'UnsplitJunction', 'NotEnoughCreases', 'TooManyUnknowns', 'NoUniqueAnswer']) {
      expect(diagnostics, rule).toMatch(new RegExp(`\\| \`Spatial\\w+\` / \`${rule}\``));
    }
    for (const status of ['has_full_cp', 'edges_too_short', 'polys_not_valid', 'polys_not_filled', 'polys_multiple_ibps', 'vertices_lack_depth', 'facets_not_valid', 'not_local_root_connectable']) expect(diagnostics).toContain(`\`${status}\``);
  });

  it('states the operational rules the catalog implies', () => {
    // Fix1 is single-pass and only exact-equal (KB G1): both guides must say to loop.
    expect(diagnostics).toMatch(/until `changed: false`/);
    expect(prompt).toMatch(/repeat until `changed: false`/);
    // Angles is never an assignment fix; angular_flat_foldability is a one-crease completion.
    expect(diagnostics).toMatch(/Angles[^\n]*Flip M\/V/);
    expect(prompt).toMatch(/never fix it by flipping mountain\/valley/);
    expect(diagnostics).toMatch(/adds \*\*one\*\* crease/i);
    // The narrow TreeMaker rule keeps its provenance scope in every guide.
    for (const text of [prompt, diagnostics, recipes]) {
      expect(text).toMatch(/unedited/);
      expect(text).toMatch(/has_full_cp/);
      expect(text).toMatch(/(Box[- ]Pleating|BP)-derived CP[^\n]*(never assumed|not\W+guaranteed|never as numerical|does not apply)/);
    }
    // BP stretch choice has no documented preference: the recipes must not prescribe one.
    expect(recipes).toMatch(/no\s+documented preference/i);
    expect(recipes).not.toMatch(/prefer the (first|largest|smallest) (configuration|pattern)/i);
    // Semantic fallbacks are consent-gated.
    expect(recipes).toMatch(/`relieve_all_strain` changes desired lengths:\s+consent is required if those lengths were fixed by the user/);
    expect(prompt).toMatch(/Explicit user constraints must not be weakened/);
  });
});

describe('creative delegation and evidence boundary (KB §0.1, §8)', () => {
  it('keeps broad creative experiments separate from changes to explicit constraints', () => {
    for (const text of [knowledgeBase, prompt, recipes, skill]) {
      expect(text).toMatch(/broad/i);
      expect(text).toMatch(/hypothes/i);
      expect(text).toMatch(/isolated/i);
      expect(text).toMatch(/explicit constraints|explicit user constraints/i);
      expect(text).not.toMatch(/never apply one "to see what happens"|not by editing the draft/);
    }
    for (const text of [diagnostics, recipes, skill]) expect(text).toContain('§0.1');
  });

  it('documents the complete proposal-to-visual-correction-to-publication path', () => {
    for (const name of ['fork_design', 'retain_design', 'pose_design', 'layout_search', 'include_source']) {
      for (const text of [prompt, recipes, skill]) expect(text).toContain(name);
    }
    for (const text of [prompt, recipes, skill]) {
      expect(text).toMatch(/evaluation/i);
      expect(text).toMatch(/diagnostic/i);
      expect(text).toMatch(/CP line IDs/i);
      expect(text).toMatch(/external (agent )?process/i);
      expect(text).toMatch(/session/i);
    }
  });

  it('does not turn paper priors, packing symmetry, or checks into creative success guarantees', () => {
    for (const text of [knowledgeBase, prompt, skill]) {
      expect(text).toMatch(/paper shape\/count/i);
      expect(text).toMatch(/final-form symmetry/i);
      expect(text).toMatch(/aesthetic/i);
      expect(text).toMatch(/finished/i);
    }
    expect(diagnostics).toMatch(/Historical or stale evidence is not current validation/);
    expect(recipes).toMatch(/OSF does not resume an arbitrary simulation trajectory/);
  });
});
