//! fmt-10 regression: cp/obj importers must reject non-finite coordinates.
//!
//! `str::parse::<f64>` accepts `NaN`, `inf`/`-inf`/`infinity` (any case), so a
//! hostile `.cp`/`.obj` file used to import as `Ok` with a NaN-poisoned model
//! that `export_cp_string` then wrote back out verbatim. Finiteness is enforced
//! only at share-encode time (`share/canon.rs` rejects non-finite with
//! `NotRepresentable`); the file-ingress vector closed here is what feeds that
//! dead link. Rejecting is a deliberate hardening divergence from Oriedita's
//! `Double.parseDouble`, which also accepts these spellings — valid files are
//! unaffected (existing `io` roundtrip tests pin byte-identical behavior).

use oristudio_cp::io::{IoError, cp, obj};

fn assert_cp_rejects(input: &str) {
    match cp::import_cp_str(input) {
        Ok(model) => panic!(
            "cp importer accepted non-finite input {input:?}: Ok({})",
            model.line_segments.len()
        ),
        Err(IoError::InvalidField { field, message }) => {
            assert_eq!(field, "cp_coordinate", "unexpected field: {field}");
            assert!(
                message.contains("finite"),
                "error should name finiteness, got: {message}"
            );
        }
        Err(other) => panic!("cp importer used untyped error for {input:?}: {other:?}"),
    }
}

fn assert_obj_rejects(input: &str) {
    match obj::import_obj_str(input) {
        Ok(model) => panic!(
            "obj importer accepted non-finite input {input:?}: Ok({})",
            model.line_segments.len()
        ),
        Err(IoError::InvalidField { field, message }) => {
            assert_eq!(field, "obj_coordinate", "unexpected field: {field}");
            assert!(
                message.contains("finite"),
                "error should name finiteness, got: {message}"
            );
        }
        Err(other) => panic!("obj importer used untyped error for {input:?}: {other:?}"),
    }
}

#[test]
fn cp_import_rejects_nan_coordinate() {
    assert_cp_rejects("1 NaN 0 1 1");
}

#[test]
fn cp_import_rejects_infinite_coordinates() {
    assert_cp_rejects("1 inf 0 1 1");
    assert_cp_rejects("1 0 -inf 1 1");
    assert_cp_rejects("1 0 0 Infinity 1");
}

#[test]
fn cp_import_accepts_finite_coordinates() {
    let model = cp::import_cp_str("1 0 0 1 1\n2 -1.5 2.25 3.5 1e3\n")
        .expect("finite cp input must stay Ok");
    assert_eq!(model.line_segments.len(), 2);
    for segment in &model.line_segments {
        for point in [segment.a, segment.b] {
            assert!(point.x.is_finite() && point.y.is_finite());
        }
    }
}

#[test]
fn obj_import_rejects_nan_vertex() {
    assert_obj_rejects("v NaN 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n");
}

#[test]
fn obj_import_rejects_infinite_vertex() {
    assert_obj_rejects("v inf 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n");
    assert_obj_rejects("v 0 0 0\nv 10 0 0\nv 0 -Infinity 0\nf 1 2 3\n");
}

#[test]
fn obj_import_accepts_finite_vertices() {
    let model = obj::import_obj_str("v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n")
        .expect("finite obj input must stay Ok");
    assert_eq!(model.line_segments.len(), 4);
    for segment in &model.line_segments {
        for point in [segment.a, segment.b] {
            assert!(point.x.is_finite() && point.y.is_finite());
        }
    }
}
