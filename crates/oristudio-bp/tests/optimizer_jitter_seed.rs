use oristudio_bp::model::{Flap, Project};
use oristudio_bp::optimizer::{LayoutMode, OptimizerOptionsBase, create_optimizer_request};
use oristudio_bp::tree::Hierarchy;

/// F-045: the view-mode jitter seed is the sole nondeterminism in request
/// building. The TS bridge echoes the effective seed on the request; these
/// tests pin the kernel side of that contract — a captured seed replays
/// byte-identically, and distinct seeds diverge exactly when flaps coincide.
fn coincident_project() -> (Project, Vec<Hierarchy>) {
    let mut project = Project::sample();
    project.design.layout.sheet.width = 10.0;
    project.design.layout.sheet.height = 10.0;
    // Freshly authored trees stack every flap at the same default position.
    project.design.layout.flaps = vec![flap(1, 5.0, 5.0, 2.0, 2.0), flap(2, 5.0, 5.0, 2.0, 2.0)];
    let hierarchies = vec![hierarchy(vec![1, 2])];
    (project, hierarchies)
}

fn view_vec(project: &Project, hierarchies: Vec<Hierarchy>, jitter_seed: u32) -> Vec<String> {
    let request = create_optimizer_request(
        project,
        hierarchies,
        OptimizerOptionsBase {
            layout: LayoutMode::View,
            use_bh: false,
            random: 0,
        },
        true,
        jitter_seed,
    )
    .unwrap();
    request
        .vec
        .unwrap()
        .iter()
        .map(|p| format!("{p:?}"))
        .collect()
}

#[test]
fn same_jitter_seed_reproduces_view_vector() {
    let (project, hierarchies) = coincident_project();
    assert_eq!(
        view_vec(&project, hierarchies.clone(), 12345),
        view_vec(&project, hierarchies, 12345),
    );
}

#[test]
fn different_jitter_seeds_diverge_on_coincident_flaps() {
    let (project, hierarchies) = coincident_project();
    assert_ne!(
        view_vec(&project, hierarchies.clone(), 12345),
        view_vec(&project, hierarchies, 67890),
    );
}

#[test]
fn distinct_flaps_are_seed_invariant() {
    let mut project = Project::sample();
    project.design.layout.sheet.width = 10.0;
    project.design.layout.sheet.height = 10.0;
    project.design.layout.flaps = vec![flap(1, 2.0, 3.0, 2.0, 2.0), flap(2, 7.0, 8.0, 2.0, 2.0)];
    let hierarchies = vec![hierarchy(vec![1, 2])];
    assert_eq!(
        view_vec(&project, hierarchies.clone(), 12345),
        view_vec(&project, hierarchies, 67890),
    );
}

fn flap(id: u32, x: f64, y: f64, width: f64, height: f64) -> Flap {
    Flap {
        id,
        x,
        y,
        width,
        height,
    }
}

fn hierarchy(leaves: Vec<u32>) -> Hierarchy {
    Hierarchy {
        leaves,
        dist_map: Vec::new(),
        parents: Vec::new(),
    }
}
