use oristudio_bp::GridType;
use oristudio_bp::io::treemaker_import::{TreeMakerParser, TreeMakerVisitor, tree_maker};

#[test]
fn tree_maker_import_reads_upstream_v5_sample() {
    let sample = include_str!("../../../tests/fixtures/bp-studio/sample.tmd5");
    let project = tree_maker("Test", sample).expect("sample imports");

    assert_eq!(project.design.title, "Test");
    assert_eq!(project.design.tree.nodes.len(), 7);
    assert_eq!(project.design.tree.edges.len(), 6);
    assert_eq!(project.design.layout.flaps.len(), 5);
    assert_eq!(project.design.tree.sheet.grid_type, GridType::Rectangular);
    assert_eq!(project.design.tree.sheet.width, 8.0);
    assert_eq!(project.design.tree.sheet.height, 8.0);
    assert_eq!(project.design.layout.sheet, project.design.tree.sheet);

    let first = &project.design.tree.nodes[0];
    assert_eq!(first.id, 1);
    assert_eq!(first.x, 4.0);
    assert_eq!(first.y, 3.0);
    assert_eq!(
        project
            .design
            .layout
            .flaps
            .iter()
            .map(|flap| flap.id)
            .collect::<Vec<_>>(),
        vec![2, 3, 5, 6, 7]
    );
    assert_eq!(
        project
            .design
            .tree
            .edges
            .iter()
            .map(|edge| edge.length)
            .collect::<Vec<_>>(),
        vec![3.0, 3.0, 2.0, 3.0, 3.0, 1.0]
    );
}

#[test]
fn tree_maker_import_applies_denominator_lcm_and_rounding_quirks() {
    let project = tree_maker("Fractional", &fractional_tmd5()).expect("fractional file imports");

    assert_eq!(project.design.title, "Fractional");
    assert_eq!(project.design.tree.sheet.width, 16.0);
    assert_eq!(project.design.tree.sheet.height, 16.0);
    assert_eq!(project.design.tree.nodes[0].name, "leaf a");
    assert_eq!(project.design.tree.nodes[0].x, 4.0);
    assert_eq!(project.design.tree.nodes[0].y, 4.0);
    assert_eq!(project.design.tree.nodes[1].x, 12.0);
    assert_eq!(project.design.tree.nodes[1].y, 12.0);
    assert_eq!(project.design.layout.flaps[0].x, 4.0);
    assert_eq!(project.design.layout.flaps[1].y, 12.0);
    assert_eq!(project.design.tree.edges[0].n1, 1);
    assert_eq!(project.design.tree.edges[0].n2, 2);
    assert_eq!(project.design.tree.edges[0].length, 1.0);
}

#[test]
fn tree_maker_import_rejects_invalid_and_corrupted_files() {
    assert!(tree_maker("Bad", "invalid content").is_err());

    let sample = include_str!("../../../tests/fixtures/bp-studio/sample.tmd5");
    assert!(
        tree_maker(
            "Bad",
            sample.get(..100).expect("ascii fixture prefix exists")
        )
        .is_err()
    );
}

#[test]
fn tree_maker_parser_exposes_direct_bp_studio_visitor_shape() {
    let data = fractional_tmd5();
    let visitor = TreeMakerVisitor::new(&data);
    let parser = TreeMakerParser::parse(visitor).expect("parser reads file");

    assert_eq!(parser.result().design.tree.nodes.len(), 2);
}

#[test]
fn tree_maker_import_uses_uniform_scale_on_non_square_paper() {
    // 1 x 0.7 paper with scale 8 and fix 2 gives independent ceilings
    // sw = 16, sh = 11, so fx = 16 but fy = 11 / 0.7 ~= 15.714.
    // Per-axis scaling maps x = 0.72 to round(0.72 * 16) = 12, while a
    // uniform fit scale min(fx, fy) maps it to round(0.72 * 15.714) = 11.
    let project = tree_maker("NonSquare", &non_square_tmd5()).expect("non-square file imports");
    assert_eq!(project.design.tree.sheet.width, 16.0);
    assert_eq!(project.design.tree.sheet.height, 11.0);
    assert_eq!(
        project.design.tree.nodes[0].x, 11.0,
        "x must use the uniform fit scale, not the wider per-axis fx"
    );
    assert_eq!(project.design.tree.nodes[0].y, 6.0);
    // The uniform scale keeps every mapped point inside the sheet.
    for node in &project.design.tree.nodes {
        assert!(node.x <= project.design.tree.sheet.width);
        assert!(node.y <= project.design.tree.sheet.height);
    }
}

#[test]
fn tree_maker_import_rejects_sub_unit_edge_instead_of_promoting_to_one() {
    // Edge 0.04 approximates to 0/1 within the 0.1 fraction tolerance, so
    // fix = 1 and the scaled length rounds to 0. Silently promoting that
    // to 1.0 invents a 25x longer tree edge.
    let err = tree_maker("Tiny", &tiny_edge_tmd5()).expect_err("sub-unit edge must not import");
    assert!(
        format!("{err:?}").contains("edge"),
        "unexpected error (want the edge-length refusal): {err:?}"
    );
}

#[test]
fn tree_maker_import_rejects_sheet_beyond_max_sheet_size() {
    let err = tree_maker("Huge", &oversize_tmd5()).expect_err("oversize sheet must not import");
    assert!(
        format!("{err:?}").contains("8192"),
        "unexpected error (want the 8192 ceiling): {err:?}"
    );
}

fn fractional_tmd5() -> String {
    [
        "tree", "5.0", "1", "1", "0.125", "false", "0.5", "0.5", "90", "true", "false", "false",
        "false", "false", "false", "false", "2", "1", "21", "0", "0", "0", "0", "0", "node", "1",
        "leaf a", "0.25", "0.25", "-999", "0", "true", "false", "false", "false", "false", "false",
        "false", "0", "0", "0", "0", "node", "2", "leaf b", "0.75", "0.75", "-999", "0", "true",
        "false", "false", "false", "false", "false", "false", "0", "0", "0", "0", "edge", "1",
        "edge 1", "0.5", "0", "1", "true", "false", "2", "1", "2",
    ]
    .join("\n")
}

fn non_square_tmd5() -> String {
    [
        "tree", "5.0", "1", "0.7", "0.125", "false", "0.5", "0.5", "90", "true", "false", "false",
        "false", "false", "false", "false", "2", "1", "21", "0", "0", "0", "0", "0", "node", "1",
        "leaf a", "0.72", "0.35", "-999", "0", "true", "false", "false", "false", "false", "false",
        "false", "0", "0", "0", "0", "node", "2", "leaf b", "0.25", "0.175", "-999", "0", "true",
        "false", "false", "false", "false", "false", "false", "0", "0", "0", "0", "edge", "1",
        "edge 1", "0.5", "0", "1", "true", "false", "2", "1", "2",
    ]
    .join("\n")
}

fn tiny_edge_tmd5() -> String {
    [
        "tree", "5.0", "1", "1", "0.125", "false", "0.5", "0.5", "90", "true", "false", "false",
        "false", "false", "false", "false", "2", "1", "21", "0", "0", "0", "0", "0", "node", "1",
        "leaf a", "0.25", "0.25", "-999", "0", "true", "false", "false", "false", "false", "false",
        "false", "0", "0", "0", "0", "node", "2", "leaf b", "0.75", "0.75", "-999", "0", "true",
        "false", "false", "false", "false", "false", "false", "0", "0", "0", "0", "edge", "1",
        "edge 1", "0.04", "0", "1", "true", "false", "2", "1", "2",
    ]
    .join("\n")
}

fn oversize_tmd5() -> String {
    [
        "tree", "5.0", "1000", "1000", "0.001", "false", "0.5", "0.5", "90", "true", "false",
        "false", "false", "false", "false", "false", "2", "1", "21", "0", "0", "0", "0", "0",
        "node", "1", "leaf a", "250", "250", "-999", "0", "true", "false", "false", "false",
        "false", "false", "false", "0", "0", "0", "0", "node", "2", "leaf b", "750", "750", "-999",
        "0", "true", "false", "false", "false", "false", "false", "false", "0", "0", "0", "0",
        "edge", "1", "edge 1", "1", "0", "1", "true", "false", "2", "1", "2",
    ]
    .join("\n")
}
