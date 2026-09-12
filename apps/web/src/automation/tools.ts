import Ajv from 'ajv';
import { AutomationError, LIMITS } from './contracts';

type Schema = Record<string, unknown>;
const str = (description = ''): Schema => ({ type: 'string', minLength: 1, maxLength: 256, description });
const num = (minimum = -1e6, maximum = 1e6): Schema => ({ type: 'number', minimum, maximum });
const integer = (minimum = 0, maximum = 1e6): Schema => ({ type: 'integer', minimum, maximum });
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
const array = (items: Schema, maxItems = 128, minItems = 0): Schema => ({ type: 'array', items, maxItems, minItems });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const point = object({ x: num(), y: num() });
const ids = array(integer(1), LIMITS.lines, 1);
const assignment = choice('mountain', 'valley', 'boundary', 'auxiliary', 'unassigned');
const segment = object({ a: point, b: point, assignment, angle: num(0, 180) }, ['a', 'b', 'assignment']);
const draft = { draft_id: str('Opaque experiment ID returned by begin_design.'), revision: integer() };
const mutation = { ...draft, request_id: str('Unique ID for this mutation; retry identical arguments with the same ID to retrieve its receipt.') };
const variant = (type: string, properties: Record<string, Schema> = {}, required = Object.keys(properties)): Schema =>
  object({ type: { const: type, type: 'string' }, ...properties }, ['type', ...required]);

export const CONSTRUCTIONS = {
  blintz: 'DrawBlintz', fish_base: 'DrawFishBase', dove_base: 'DrawDoveBase', bird_base: 'DrawBirdBase', frog_base: 'DrawFrogBase',
  perpendicular: 'PerpendicularDraw', parallel: 'ParallelDraw', triangle_bisectors: 'Inward', symmetric: 'SymmetricDraw',
  axiom5: 'Axiom5', axiom7: 'Axiom7', divide: 'LineSegmentDivision', square_bisector: 'SquareBisector',
} as const;
export const REPAIRS = { overlaps: 'Fix1', intersections: 'Fix2', merge_vertices: 'DeleteExtraVertices',
  snap: 'FixInaccurate', angular_flat_foldability: 'VertexMakeAngularlyFlatFoldable' } as const;
export const CONSTRUCTION_INPUTS = {
  bases: 'blintz/fish_base/dove_base/bird_base/frog_base: two opposite corners of the template square in order: canonical (-200,-200), then (200,200). This is the square diagonal, not an edge; generated lines use assignment (default mountain), so inspect and assign folds afterward.',
  perpendicular: '[point, pick on existing reference crease, optional pick on destination crease]',
  parallel: '[point, pick on existing parallel reference crease, pick on destination crease]',
  triangle_bisectors: '[triangle vertex A, B, C]; draws all three segments to the incenter',
  symmetric: '[pick on source crease, pick on mirror crease], or [source start, shared vertex, mirror end]',
  axiom5: '[point to fold onto target, pick on target crease, point the fold passes through, optional destination pick]; preview segments are zero-based candidates',
  axiom7: '[point to fold onto target, pick on target crease, pick on perpendicular reference crease, optional destination pick]',
  divide: '[start, end], divisions=2..100; inserts a new divided segment',
  square_bisector: '[ray point A, vertex, ray point B, pick on destination crease]',
} as const;

const cpOperation = { oneOf: [
  variant('add_creases', { creases: array(segment, LIMITS.operations, 1) }),
  variant('delete_creases', { line_ids: ids }),
  variant('assign_creases', { line_ids: ids, assignment, angle: num(0, 180) }, ['line_ids', 'assignment']),
  variant('transform_creases', { line_ids: ids, translate: point, rotate_degrees: num(-360, 360), scale: num(0.001, 1000), center: point, copy: { type: 'boolean' } }, ['line_ids']),
  variant('construct', { construction: choice(...Object.keys(CONSTRUCTIONS)), points: array(point, 8, 1), assignment, divisions: integer(2, 100), candidate: integer(0, 16) }, ['construction', 'points']),
  variant('repair', { repair: choice(...Object.keys(REPAIRS)), line_ids: ids, points: array(point, 8), precision: num(0.000001, 100) }, ['repair']),
  variant('insert_vertex', { point }),
] };

const condition = { oneOf: [
  ...['node_on_corner', 'node_on_edge', 'node_symmetric'].map(type => variant(type, { node: integer(1) })),
  variant('nodes_paired', { node1: integer(1), node2: integer(1) }),
  variant('nodes_collinear', { node1: integer(1), node2: integer(1), node3: integer(1) }),
  variant('edge_length_fixed', { edge: integer(1) }),
  variant('edges_same_strain', { edge1: integer(1), edge2: integer(1) }),
  variant('node_fixed', { node: integer(1), x_fixed: { type: 'boolean' }, y_fixed: { type: 'boolean' }, x_fix_value: num(), y_fix_value: num() }),
  variant('path_active', { node1: integer(1), node2: integer(1) }),
  variant('path_angle_fixed', { node1: integer(1), node2: integer(1), angle: num(-360, 360) }),
  variant('path_angle_quant', { node1: integer(1), node2: integer(1), quant: integer(1, 360), quant_offset: num(-360, 360) }),
] };
const treeOperation = { oneOf: [
  variant('add_node', { loc: point, label: str(), connect_to: integer(1), edge_length: num(0.000001) }, ['loc']),
  variant('move_node', { id: integer(1), loc: point }),
  ...['delete_node', 'delete_edge', 'delete_condition'].map(type => variant(type, { id: integer(1) })),
  variant('update_node_label', { id: integer(1), label: str() }),
  variant('add_edge', { node1: integer(1), node2: integer(1), length: num(0.000001), label: str() }, ['node1', 'node2']),
  variant('update_edge', { id: integer(1), length: num(0.000001), strain: num(-0.99, 100), stiffness: num(0.000001), label: str() }, ['id']),
  variant('update_paper', { width: num(0.000001), height: num(0.000001), scale: num(0.000001) }, ['width', 'height']),
  variant('set_symmetry', { has_symmetry: { type: 'boolean' }, sym_loc: point, sym_angle: num(-360, 360) }, ['has_symmetry']),
  variant('add_condition', { kind: condition }), variant('update_condition', { id: integer(1), kind: condition }),
  variant('make_root', { node: integer(1) }), variant('split_edge', { edge: integer(1), distance: num(0.000001) }),
  variant('set_edge_lengths', { edges: ids, length: num(0.000001) }), variant('scale_edge_lengths', { edges: ids, factor: num(0.000001) }),
  ...['remove_strain', 'relieve_strain', 'absorb_edges'].map(type => variant(type, { edges: ids })),
  variant('absorb_nodes', { nodes: ids }),
  ...['renormalize_to_unit_scale', 'absorb_redundant_nodes', 'remove_all_strain', 'relieve_all_strain'].map(type => variant(type)),
] };
const bpId = integer(0);
const bpOperation = { oneOf: [
  variant('initialize_tree', { root: point, leaves: array(object({ loc: point, length: integer(1, 1024) }), 64, 2) }),
  variant('add_leaf', { parent: bpId, length: integer(1, 1024) }),
  variant('delete_leaves', { ids: array(bpId, 128, 1) }),
  variant('move_node', { id: bpId, x: num(), y: num() }),
  variant('edge_length', { node1: bpId, node2: bpId, length: integer(1, 1024) }),
  variant('move_flap', { id: bpId, x: num(), y: num() }),
  variant('resize_flap', { id: bpId, width: integer(0, 1024), height: integer(0, 1024) }),
  variant('sheet', { grid: choice('rectangular', 'diagonal'), width: integer(1, 1024), height: integer(1, 1024) }),
  variant('complete_stretch', { id: str() }),
  variant('stretch_config', { id: str(), delta: integer(-100, 100) }),
  variant('stretch_pattern', { id: str(), delta: integer(-100, 100) }),
  variant('move_device', { id: str(), index: integer(), x: num(), y: num() }),
] };

function tool(name: string, description: string, properties: Record<string, Schema> = {}, required = Object.keys(properties), readOnlyHint = false) {
  return { name, description, inputSchema: object(properties, required), annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false } };
}

export const TOOLS = [
  tool('workspace', 'Discover live document summaries, experiment IDs, limits, units and the autonomous workflow. No document content is sent to telemetry.', {}, [], true),
  tool('workspace_history', 'Undo or redo exactly one Edit-canvas action using the application history. Requires history_token, live revision and load serial from workspace; never falls back to another design. Undoing a committed experiment restores its complete prior canvas state.', { request_id: mutation.request_id, history_token: str(), live_revision: integer(), load_serial: integer(), direction: choice('undo', 'redo') }),
  tool('begin_design', 'Begin an isolated experiment. source=active clones the Edit canvas or the active design tab of the requested kind; source=new creates a square CP or empty TreeMaker/BP tree. For BP, initialize_tree seeds the first root and leaves. source=import reads supplied content, never a host path. Existing user work is preserved.', {
    request_id: mutation.request_id, source: choice('new', 'active', 'import'), kind: choice('crease_pattern', 'treemaker', 'box_pleat'), title: str(),
    format: choice('cp', 'fold', 'ori', 'tmd5', 'bps'), content: { type: 'string', maxLength: LIMITS.inputBytes },
  }, ['request_id', 'source', 'kind']),
  tool('inspect_design', 'Read geometry, assignments, topology and diagnostics at a specific draft revision. CP line IDs are one-based and valid ONLY at that revision; refresh after any edit. Paginate CP lines with offset/limit.', { ...draft, offset: integer(0, LIMITS.lines), limit: integer(1, 2000) }, Object.keys(draft), true),
  tool('edit_creases', 'Apply a semantic batch atomically to a CP experiment. All IDs refer to the pre-batch revision; operations changing topology must be last or use coordinates in subsequent operations. Converting auxiliary lines changes topology: omit angle, inspect new IDs, then assign angles separately. Invalid/no-solution operations leave the draft untouched. CP coordinates use Oriedita model space: default paper [-200,200]², +y down.', { ...mutation, operations: array(cpOperation, LIMITS.operations, 1) }),
  tool('preview_construction', 'Resolve construction candidates through the real kernel without changing the experiment. Read workspace.construction_inputs for ordered point semantics. Use this before ambiguous Axiom or construction operations; returns points, segments and diagnostics for choosing a candidate.', { ...draft, construction: choice(...Object.keys(CONSTRUCTIONS)), points: array(point, 8, 1), assignment }, [...Object.keys(draft), 'construction', 'points'], true),
  tool('edit_tree', 'Atomically edit a TreeMaker design using its typed tree/constraint operations. Node and edge IDs are one-based. Inspect created IDs before referencing new nodes. Then optimize, build CP, and derive a CP experiment.', { ...mutation, operations: array(treeOperation, LIMITS.operations, 1) }),
  tool('edit_box_pleat', 'Atomically edit a Box Pleating Studio tree, sheet, flap packing or stretch. initialize_tree authors an empty tree as a root (ID 0) and at least two leaves (IDs 1..n); use add_leaf thereafter. Uses BP IDs (including zero) returned by inspect_design. Move seeded flaps to a valid packing and run packing analysis before deriving the CP.', { ...mutation, operations: array(bpOperation, LIMITS.operations, 1) }),
  tool('checkpoint_design', 'Save a named recovery point inside an experiment, without touching application history.', { ...mutation, label: str() }),
  tool('rollback_design', 'Restore a checkpoint atomically; increments revision and invalidates old analysis. A stale revision is refused.', { ...mutation, checkpoint_id: str() }),
  tool('analyze_design', 'Start a bounded asynchronous analysis job. CP checks return localized Oriedita diagnostics; flat_fold runs actual layer-order solving. TreeMaker optimize/build modifies only the experiment on success. BP packing returns real kernel validation. Poll job_status.', { ...mutation, analysis: choice('checks', 'flat_fold', 'packing', 'optimize_scale', 'optimize_edges', 'optimize_strain', 'build_cp'), starting_face: integer(1), case_limit: integer(1, 16) }, [...Object.keys(mutation), 'analysis']),
  tool('simulate_design', 'Start real Origami Simulator physics in an isolated worker. Fold target is 0..1; explicit max_steps bounds work. Results separate solver_settled from target_attainment (full requested source-crease coverage plus oriented mesh angle residuals, tolerance 5 degrees; omitted or unmeasurable targets are unknown). Convergence alone does not mean the requested target was attained; inspect outcome and residuals. Not a collision or foldability proof. Poll job_status, then render_view with the job ID.', { ...mutation, fold_amount: num(0, 1), max_steps: integer(1, 20000) }),
  tool('job_status', 'Read a job. Results and artifacts identify the exact draft/revision analyzed. stale=true means later edits exist. Terminal jobs retain their result until discarded or expiry.', { job_id: str() }, ['job_id'], true),
  tool('cancel_job', 'Cancel a pending job. Fold search uses the native cooperative stop flag; isolated simulation/optimizer workers are terminated. No partial mutation is committed.', { job_id: str() }),
  tool('derive_crease_pattern', 'Create a separate editable CP experiment from the current TreeMaker build or BP packing, keeping the source design intact. Build TreeMaker CP first. Rejects missing/invalid geometry.', { ...mutation }),
  tool('render_view', 'Return a PNG image plus view metadata. crease_pattern uses the actual CP export renderer; folded uses a completed flat_fold job; simulation uses a completed simulation job with a selectable camera. Images can be inspected directly by vision agents.', { ...draft, view: choice('crease_pattern', 'folded', 'simulation'), job_id: str(), camera: choice('isometric', 'top', 'front', 'side'), size: integer(128, 2048) }, [...Object.keys(draft), 'view'], true),
  tool('export_design', 'Return editable file/artifact content to the client; no host filesystem access. OSF preserves Ori Studio document data, CP/ORI/FOLD are interchange formats; TMD5/BPS preserve design trees. SVG/PNG and simulation OBJ export actual rendered/solved geometry. Semantic losses (CP/ORI non-180 angles, CP unassigned creases) are refused. Nonblocking losses require allow_loss=true after reading the returned losses. Save returned content using your client.', { ...draft, format: choice('osf', 'cp', 'ori', 'fold', 'tmd5', 'bps', 'svg', 'png', 'obj'), job_id: str(), allow_loss: { type: 'boolean', description: 'Explicitly accept reported nonblocking omissions. Cannot override semantic-loss refusals; use FOLD or OSF.' } }, [...Object.keys(draft), 'format'], true),
  tool('commit_design', 'Publish the experiment into the application. CP replacement is ONE undoable action and requires the live revision token captured at begin_design; concurrent user edits cause conflict. New CP experiments also capture a live token, so they cannot overwrite later work. The experiment remains available for export. Trees publish as a new design tab.', { ...mutation, label: str('Human-readable undo label.') }),
  tool('discard_design', 'Release an experiment and its jobs/checkpoints. Never changes the live document.', { ...mutation }),
] as const;

/** Compact discovery survives clients that simplify oneOf or omit numeric bounds.
 * Generated from the canonical schema, never a second operation registry.
 */
function operationHelp(schema: { oneOf: Schema[] }) {
  return schema.oneOf.map(item => {
    const props = item.properties as Record<string, Schema>;
    return { type: props.type.const, required: (item.required as string[]).filter(k => k !== 'type'),
      fields: Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'type').map(([k, v]) => [k,
        v.oneOf ? 'tagged condition; see conditions' : v.enum ?? (v.type === 'object' ? Object.keys(v.properties as object).join(', ') : v.type === 'array' ? 'array' : v.type)])) };
  });
}
export const CAPABILITIES = {
  operations: { edit_creases: operationHelp(cpOperation), edit_tree: operationHelp(treeOperation), edit_box_pleat: operationHelp(bpOperation), conditions: operationHelp(condition) },
  bounds: { case_limit: '1..16', starting_face: '>=1', fold_amount: '0..1 fraction; converted to 0..100 percent at simulator boundary', max_steps: '1..20000', angle: '0..180 degrees magnitude', operations_per_edit: LIMITS.operations },
  formats: { crease_pattern: { import: ['cp', 'ori', 'fold'], export: ['osf', 'cp', 'ori', 'fold', 'svg', 'png', 'obj (simulation job)'] }, treemaker: { import: ['tmd5'], export: ['tmd5', 'osf', 'fold', 'svg', 'png', 'obj (simulation job)'] }, box_pleat: { import: ['bps'], export: ['bps', 'osf', 'fold', 'svg', 'png', 'obj (simulation job)'] } },
  repair_policy: 'Repairs invoke individual Oriedita operations, not guaranteed normalization. Run checks afterward; inspect new IDs. changed means document state changed; geometry_changed distinguishes geometry/assignment changes from selection/metadata.',
  concurrency: 'One job per draft. Edits, checkpoint, rollback and commit require that job to finish or be cancelled. Inspection/render/export can read immutable snapshots; their revision identifies the snapshot used.',
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(TOOLS.map(t => [t.name, ajv.compile(t.inputSchema)]));
export function validateTool(name: string, args: unknown): asserts args is Record<string, unknown> {
  const validate = validators.get(name);
  if (!validate) throw new AutomationError('unknown_tool', `Unknown tool: ${name}`);
  if (!validate(args)) throw new AutomationError('invalid_arguments', ajv.errorsText(validate.errors));
  if (JSON.stringify(args).length > LIMITS.inputBytes) throw new AutomationError('resource_limit', 'Tool input exceeds 8 MiB');
}
