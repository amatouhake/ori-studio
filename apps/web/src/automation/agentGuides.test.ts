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

/**
 * Split a guide into the smallest units an instruction lives in: one table row,
 * one list item (with its indented continuation lines, but not nested items,
 * which are their own units), or one paragraph. A tag later in a multi-step
 * list therefore cannot cover an earlier untagged step.
 */
const LIST_ITEM = /^\s*(\d+\.|[-*])\s/;
function units(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => { if (current.length) out.push(current.join('\n')); current = []; };
  for (const line of text.split('\n')) {
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith('|')) { flush(); out.push(line); continue; }
    if (LIST_ITEM.test(line) || (current.length && !/^\s/.test(line) && LIST_ITEM.test(current[0]))) { flush(); current.push(line); continue; }
    current.push(line);
  }
  flush();
  return out;
}
const unitsWith = (text: string, needle: string) => units(text).filter(unit => unit.includes(needle));

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
  'simulation_diverged', 'export_loss_blocked', 'x_fixed', 'y_fixed', 'quant_offset', 'file_frames',
  'vertices_coords', 'edges_vertices', 'frame_classes', 'node1', 'node2', 'edge1', 'edge2', 'flap_ids',
  'box_pleat', 'crease_pattern',
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
    expect(recipes).toMatch(/relieve_all_strain[^\n]*consent|consent[^\n]*relieve_all_strain/);
    expect(prompt).toMatch(/requires the user's explicit agreement/);
  });
});

describe('action/consent boundary (KB §0.1)', () => {
  it('the knowledge base defines the boundary the guides cite', () => {
    expect(knowledgeBase).toMatch(/^### 0\.1 Action boundary/m);
    for (const text of [diagnostics, recipes, skill]) expect(text).toContain('§0.1');
  });

  // Every unit that mentions a design-changing operation is either tagged [H],
  // limited to transcribing user-supplied values, or a prohibition. A [U] or a
  // delegation note is additionally acceptable for the two placement operations.
  const designChanging = ['transform_creases', 'delete_creases', 'assign_creases', 'add_creases', 'resize_flap', 'stretch_config', 'stretch_pattern',
    'relieve_all_strain', 'relieve_strain', 'make_root', 'split_edge', 'path_active', 'path_angle_quant', 'add_node', 'add_edge', 'update_edge',
    'add_condition', 'set_symmetry', 'edges_same_strain', 'add_leaf', 'edge_length', 'initialize_tree', 'set_edge_lengths', 'scale_edge_lengths'];
  const placement = ['move_node', 'move_flap'];
  const guarded = /\[H\]|user-supplied|Do \*\*not\*\*|never|forbidden/i;
  it.each(designChanging)('%s appears only in [H]-tagged, user-supplied or prohibitive units', op => {
    for (const [name, text] of [['diagnostics', diagnostics], ['recipes', recipes]] as const) {
      const found = unitsWith(text, `\`${op}`);
      for (const unit of found) {
        if (unit.startsWith('|') && unit.includes('---')) continue; // table separator
        if (/^\| `?(kind|repair|cp_status|Field|Rule|Step|MCP op|Action)/.test(unit) && !/\| [^|]*\| [^|]*\|/.test(unit.slice(1))) continue; // header row
        expect(unit, `${name}: ${unit.slice(0, 140)}`).toMatch(guarded);
      }
    }
  });
  it.each(placement)('%s appears only in [U]/[H]/delegated/prohibitive units', op => {
    for (const [name, text] of [['diagnostics', diagnostics], ['recipes', recipes]] as const) {
      for (const unit of unitsWith(text, `\`${op}`)) {
        if (unit.startsWith('|') && unit.includes('---')) continue;
        expect(unit, `${name}: ${unit.slice(0, 140)}`).toMatch(/\[H\]|\[U\]|delegat|user-supplied|Do \*\*not\*\*|never|forbidden/i);
      }
    }
  });

  it('R4 transcribes user-supplied tree values and treats invented ones and edges_same_strain as [H]', () => {
    const r4 = recipes.slice(recipes.indexOf('## R4'), recipes.indexOf('## R5'));
    const step2 = units(r4).find(unit => /^2\. /.test(unit))!;
    expect(step2).toMatch(/user-supplied structure and values only/);
    expect(step2).toMatch(/\*\*\[H\]\*\* Anything the user did not specify/);
    expect(step2).toMatch(/not inventing lengths or constraints/);
    const step3 = units(r4).find(unit => /^3\. /.test(unit))!;
    expect(step3).toMatch(/\*\*\[H\]\*\*\s+The `edges_same_strain` pairing/);
    expect(step3).not.toMatch(/after pairing symmetric\s+edges with `edges_same_strain` conditions \[U\]/);
    expect(knowledgeBase).toMatch(/\*\*Transcription is not a decision\.\*\*/);
  });

  it('R5 transcribes user-supplied BP values, resizes only to specified dimensions, and delegates placement only', () => {
    const r5 = recipes.slice(recipes.indexOf('## R5'), recipes.indexOf('## R6'));
    const step2 = units(r5).find(unit => /^2\. /.test(unit))!;
    expect(step2).toMatch(/user-supplied structure and values only/);
    expect(step2).toMatch(/`resize_flap \{id, width,\s+height\}` only to the dimensions the user specified/);
    expect(step2).not.toMatch(/`move_flap` \/ `resize_flap` with integer/);
    expect(step2).toMatch(/\*\*\[H\]\*\* Any length, flap size, sheet size or extra leaf/);
    expect(step2).toMatch(/not inventing\s+dimensions/);
  });

  it('R3 does not let the agent move geometry for Angles without agreement', () => {
    const row = recipes.split('\n').find(line => line.startsWith('| `Angles`'))!;
    expect(row).toMatch(/\*\*\[H\]\*\*/);
    expect(row).toMatch(/after agreement/);
    expect(row).not.toMatch(/^\| `Angles` \| [^|]* \| Never reassign\. `transform_creases`/);
    const diag = diagnostics.split('\n').find(line => line.startsWith('| `CheckCamv` / `Angles`'))!;
    expect(diag).toMatch(/\[H\] Otherwise report/);
    expect(diag).toMatch(/move vertices unasked/);
  });

  it('R3 presents Maekawa / BigLittleBig candidates instead of applying them', () => {
    for (const rule of ['Maekawa', 'BigLittleBig']) {
      const row = recipes.split('\n').find(line => line.startsWith(`| \`${rule}\``))!;
      expect(row).toMatch(/\*\*\[H\]\*\*/);
      expect(row).toMatch(/Present/);
    }
    expect(prompt).toMatch(/apply one only after the user chooses or has delegated/);
  });

  it('R5 distinguishes move_flap (delegated by a packing request) from resize_flap (explicit consent) and gates stretch stepping', () => {
    const packing = recipes.slice(recipes.indexOf('## R5'), recipes.indexOf('## R6'));
    expect(packing).toMatch(/`resize_flap` is never a packing\s+shortcut/);
    expect(packing).toMatch(/explicit consent/);
    expect(packing).not.toMatch(/move\/resize/);
    expect(packing).toMatch(/\*\*\[H\]\*\* Stepping `stretch_config/);
    expect(packing).toMatch(/only when the\s+user asks for alternatives, or agrees/);
    expect(packing).toMatch(/without ranking/);
    const diag = diagnostics.split('\n').find(line => line.startsWith('| `packing.valid: false`'))!;
    expect(diag).toMatch(/\[H, delegated by "pack these flaps"\] `move_flap`/);
    expect(diag).toMatch(/\[H, explicit consent\] `resize_flap`/);
    expect(prompt).toMatch(/"Pack these flaps" delegates flap placement \(`move_flap`\), not sizes/);
  });

  it('the default (no-consent) action set is closed and identical across guides', () => {
    for (const text of [prompt, skill]) {
      expect(text).toMatch(/`repair: overlaps`\/`intersections`\/\s*`merge_vertices`/);
      expect(text).toMatch(/snap[^\n]*22\.5°\/box-pleat/);
      expect(text).toMatch(/failure-message remedies/);
    }
    expect(recipes).toMatch(/The only default \(\[U\]\) actions here are `repair:\n"intersections"`, `repair: "snap"`[^\n]*\n`repair: "merge_vertices"`/);
    expect(prompt).toMatch(/never apply one "to see what happens"/);
  });
});
