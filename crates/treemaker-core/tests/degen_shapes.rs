//! Degenerate-shape regression tests (F-003, F-030, F-031).
//!
//! Crafted or corrupted documents can describe paths with no nodes and
//! polygons whose ring node/path lists disagree. Those shapes must surface as
//! typed errors, never as panics.

use std::panic::{AssertUnwindSafe, catch_unwind};

use treemaker_core::Tree;

const SEED_V4: &str = include_str!("../testdata/tmModelTester_1.tmd5");

/// Zero the `nodes` array of the first v5 `path` block in serialized text.
///
/// v5 path layout after the `path` tag line (14 header lines): index,
/// 4 floats, 7 bools, fwd poly, bkd poly — then the nodes count followed by
/// the node ids.
fn zero_first_path_nodes(text: &str) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let tag = lines
        .iter()
        .position(|line| line == "path")
        .expect("v5 text has a path block");
    let count_at = tag + 14 + 1;
    let n: usize = lines[count_at]
        .trim()
        .parse()
        .expect("path nodes count line");
    assert!(n >= 2, "base path must be non-degenerate, found {n} nodes");
    lines[count_at] = "0".to_string();
    lines.drain(count_at + 1..count_at + 1 + n);
    let mut out = lines.join("\n");
    if text.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Rewrite the `nodes` array of the first v5 `path` block so both endpoints
/// are the same node — the right count, no distinct endpoints.
fn collapse_first_path_endpoints(text: &str) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let tag = lines
        .iter()
        .position(|line| line == "path")
        .expect("v5 text has a path block");
    let count_at = tag + 14 + 1;
    let n: usize = lines[count_at]
        .trim()
        .parse()
        .expect("path nodes count line");
    assert!(n >= 2, "base path must be non-degenerate, found {n} nodes");
    let first = lines[count_at + 1].clone();
    lines[count_at] = "2".to_string();
    lines.splice(count_at + 1..count_at + 1 + n, [first.clone(), first]);
    let mut out = lines.join("\n");
    if text.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Truncate `ring_paths` of the `poly_pos`-th v5 `poly` block (0-based in
/// serialization order) so it no longer corresponds to `ring_nodes`.
///
/// With `clear_owned`, the poly's owned-nodes/owned-paths payloads are zeroed
/// too (the F-030 "cleared" variant, which reaches a different walk).
fn truncate_poly_ring_paths(text: &str, poly_pos: usize, clear_owned: bool) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| *line == "poly")
        .map(|(i, _)| i)
        .collect();
    assert!(
        starts.len() > poly_pos,
        "v5 text has {} poly blocks, need #{poly_pos}",
        starts.len()
    );
    // Read-only cursor walk over the poly block (v5 writer order): index,
    // centroid (2), sub flag, ring_nodes, ring_paths, cross, inset, spoke,
    // ridge (1), node_locs (count + 2 lines per point), local-root vertices,
    // local-root creases, owned nodes/paths/polys/creases/facets.
    let mut c = starts[poly_pos] + 1 + 1 + 2 + 1;
    let rn: usize = lines[c].trim().parse().expect("ring nodes count");
    let rpc_at = c + 1 + rn;
    let rp: usize = lines[rpc_at].trim().parse().expect("ring paths count");
    assert!(
        rn >= 3,
        "base poly must be an honest nn>=3 ring, found {rn} nodes"
    );
    assert_eq!(rp, rn, "honest-built rings correspond, found {rn}v{rp}");
    c = rpc_at + 1 + rp;
    for _ in 0..3 {
        let n: usize = lines[c].trim().parse().expect("poly array count");
        c += 1 + n;
    }
    c += 1; // ridge path
    let nloc: usize = lines[c].trim().parse().expect("node locs count");
    c += 1 + 2 * nloc;
    for _ in 0..2 {
        let n: usize = lines[c].trim().parse().expect("poly array count");
        c += 1 + n;
    }
    let owned_nodes_at = c;
    let owned_nodes_len: usize = lines[c].trim().parse().expect("owned nodes count");
    c += 1 + owned_nodes_len;
    let owned_paths_at = c;
    let owned_paths_len: usize = lines[c].trim().parse().expect("owned paths count");

    // Mutate back-to-front so recorded positions stay valid.
    if clear_owned {
        lines[owned_paths_at] = "0".to_string();
        lines.drain(owned_paths_at + 1..owned_paths_at + 1 + owned_paths_len);
        lines[owned_nodes_at] = "0".to_string();
        lines.drain(owned_nodes_at + 1..owned_nodes_at + 1 + owned_nodes_len);
    }
    // Drop the final ring path id: an rn v rn-1 mismatch.
    lines[rpc_at] = (rp - 1).to_string();
    lines.remove(rpc_at + rp);

    let mut out = lines.join("\n");
    if text.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// An owned leaf path with real endpoints, suitable for emptying.
fn leaf_owned_path(tree: &Tree) -> usize {
    tree.paths
        .iter()
        .find(|p| p.is_leaf && p.nodes.len() >= 2 && tree.owned_paths.contains(&p.index))
        .expect("seed has an owned leaf path with endpoints")
        .index
}

/// Serialize a seed fixture through the v5 writer so text surgery below acts
/// on canonical writer output.
fn canonical_v5(seed: &str) -> String {
    Tree::from_tmd_str(seed)
        .expect("seed fixture parses")
        .to_tmd5_string()
}

/// Honestly built tree: parsed seed plus real polygon rings (fixture 1 builds
/// a 3-node ring with corresponding ring paths).
fn honestly_built_polys() -> (Tree, usize) {
    let mut tree = Tree::from_tmd_str(SEED_V4).expect("seed parses");
    tree.build_tree_polys().expect("honest poly build works");
    let pos = tree
        .polys
        .iter()
        .position(|p| p.ring_nodes.len() >= 3)
        .expect("honest build yields an nn>=3 ring");
    assert_eq!(
        tree.polys[pos].ring_paths.len(),
        tree.polys[pos].ring_nodes.len(),
        "honest-built rings correspond"
    );
    (tree, pos)
}

// ---- F-003: empty Path.nodes ----

#[test]
fn f003_empty_path_text_is_rejected_at_parse() {
    let mutated = zero_first_path_nodes(&canonical_v5(SEED_V4));
    let result = Tree::from_tmd_str(&mutated);
    assert!(
        result.is_err(),
        "empty path nodes must be rejected at parse, never admitted"
    );
}

/// The readers check only the node count; a path whose two endpoints are the
/// same node passes them and is caught by `validate()`, which every
/// `from_tmd_str` version runs before returning. Pinned here so the reader
/// message's "distinct" stays true at the API boundary whichever layer
/// enforces it.
#[test]
fn same_endpoint_path_text_is_rejected_at_parse() {
    let mutated = collapse_first_path_endpoints(&canonical_v5(SEED_V4));
    let result = Tree::from_tmd_str(&mutated);
    let message =
        result.expect_err("a path whose endpoints are one node must be rejected at parse");
    assert!(
        message.to_string().contains("distinct endpoint"),
        "rejected for the endpoint rule, not incidental damage: {message}"
    );
}

#[test]
fn f003_empty_path_nodes_make_optimizers_err_never_panic() {
    let base = Tree::from_tmd_str(SEED_V4).expect("seed parses");
    let mut failures = Vec::new();
    for name in ["scale", "edges", "strain"] {
        let mut tree = base.clone();
        let pid = leaf_owned_path(&tree);
        tree.paths[pid - 1].nodes.clear();
        let outcome = catch_unwind(AssertUnwindSafe(|| match name {
            "scale" => tree.optimize_scale().map(|_| ()),
            "edges" => tree.optimize_edges().map(|_| ()),
            _ => tree.optimize_strain().map(|_| ()),
        }));
        match outcome {
            Ok(Ok(())) => failures.push(format!("{name} returned Ok")),
            Ok(Err(_)) => {}
            Err(_) => failures.push(format!("{name} panicked")),
        }
    }
    assert!(
        failures.is_empty(),
        "optimizers must Err on empty path nodes, never panic: {failures:?}"
    );
}

// ---- F-030: ring_nodes/ring_paths mismatch ----

#[test]
fn f030_truncated_ring_paths_kept_text_is_rejected_at_parse() {
    let (tree, pos) = honestly_built_polys();
    let mutated = truncate_poly_ring_paths(&tree.to_tmd5_string(), pos, false);
    let result = Tree::from_tmd_str(&mutated);
    assert!(
        result.is_err(),
        "truncated ring_paths (kept payload) must be rejected at parse"
    );
}

#[test]
fn f030_truncated_ring_paths_cleared_text_is_rejected_at_parse() {
    let (tree, pos) = honestly_built_polys();
    let mutated = truncate_poly_ring_paths(&tree.to_tmd5_string(), pos, true);
    let result = Tree::from_tmd_str(&mutated);
    assert!(
        result.is_err(),
        "truncated ring_paths (cleared payload) must be rejected at parse"
    );
}

#[test]
fn f030_cleared_ring_paths_in_memory_make_build_err_never_panic() {
    let (mut tree, pos) = honestly_built_polys();
    let poly_id = tree.polys[pos].index;
    tree.polys[poly_id - 1].ring_paths.pop();
    tree.polys[poly_id - 1].owned_nodes.clear();
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        tree.build_polys_and_crease_pattern().map(|_| ())
    }));
    match outcome {
        Ok(result) => assert!(
            result.is_err(),
            "mismatched rings must make build Err, never Ok"
        ),
        Err(_) => panic!("build panicked on mismatched rings (F-030)"),
    }
}

// ---- F-031: empty path in the polygon ring walk ----

#[test]
fn f031_empty_polygon_path_makes_poly_build_err_never_panic() {
    let mut tree = Tree::from_tmd_str(SEED_V4).expect("seed parses");
    assert!(
        tree.nodes.iter().any(|n| n.is_border),
        "seed has border nodes for the ring walk"
    );
    // Stale v5-style flags on an empty-nodes path: polygon, non-border, with
    // no fwd/bkd linkage so both ring-walk entries are reachable.
    let pid = leaf_owned_path(&tree);
    let path = &mut tree.paths[pid - 1];
    path.nodes.clear();
    path.is_polygon = true;
    path.is_border = false;
    path.fwd_poly = None;
    path.bkd_poly = None;
    let outcome = catch_unwind(AssertUnwindSafe(|| tree.build_tree_polys().map(|_| ())));
    match outcome {
        Ok(result) => assert!(
            result.is_err(),
            "empty polygon path must make build Err, never Ok"
        ),
        Err(_) => panic!("build panicked on an empty polygon path (F-031)"),
    }
}

// ---- Security hardening: forged counts must not drive huge preallocs ----

use std::time::{Duration, Instant};

/// A tiny v5 document whose header claims a billion nodes. Pre-hardening,
/// `Vec::with_capacity(1e9)` for `Node` requests on the order of 100GB and
/// aborts before the first real read; now the reservation is capped and the
/// missing body fails fast with a typed parse error.
#[test]
fn forged_huge_node_count_is_rejected_without_huge_allocation() {
    let text = [
        "tree",
        "5.0",
        "1.0",
        "1.0",
        "0.1",
        "false",
        "0.0",
        "0.0",
        "0.0",
        "false",
        "false",
        "false",
        "false",
        "false",
        "false",
        "false",
        "1000000000",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
    ]
    .join("\n")
        + "\n";
    let start = Instant::now();
    let result = Tree::from_tmd_str(&text);
    let elapsed = start.elapsed();
    assert!(
        result.is_err(),
        "forged node count must be rejected, never admitted"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "rejection must be fast (no giant reservation), took {elapsed:?}"
    );
}

/// Same shape one level down: a single valid node header whose `edges` array
/// claims a billion entries. Exercises the capped `read_index_array` path.
#[test]
fn forged_huge_index_array_is_rejected_without_huge_allocation() {
    // v5 node layout: tag, index, label, loc (2), depth, elevation, 7 bools,
    // then the edges array.
    let text = [
        "tree",
        "5.0",
        "1.0",
        "1.0",
        "0.1",
        "false",
        "0.0",
        "0.0",
        "0.0",
        "false",
        "false",
        "false",
        "false",
        "false",
        "false",
        "false",
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "node",
        "1",
        "A",
        "0.0",
        "0.0",
        "0.0",
        "0.0",
        "false",
        "false",
        "false",
        "false",
        "false",
        "false",
        "false",
        "1000000000",
    ]
    .join("\n")
        + "\n";
    let start = Instant::now();
    let result = Tree::from_tmd_str(&text);
    let elapsed = start.elapsed();
    assert!(
        result.is_err(),
        "forged index array count must be rejected, never admitted"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "rejection must be fast (no giant reservation), took {elapsed:?}"
    );
}
