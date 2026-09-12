//! Regression: empty/garbage OBJ must never yield a phantom origin crease.
//!
//! `import_obj_str` seeds its accumulator with a dummy point and a default
//! line (Oriedita `ObjImporter` parity for real files). With no parseable
//! content that seed leaked through as `Ok(1)` — a zero-length segment at
//! the origin. The cp importer returns `Ok(0)` on empty input; OBJ follows
//! the same contract: empty/garbage yields `Ok(empty)` or a typed `Err`,
//! never `Ok(phantom)`.

use oristudio_cp::io::obj;

fn assert_no_phantom(input: &str) {
    if let Ok(model) = obj::import_obj_str(input) {
        assert!(
            model.line_segments.is_empty(),
            "phantom import: {input:?} yielded {} segment(s), expected empty model",
            model.line_segments.len()
        );
    }
}

#[test]
fn obj_import_of_empty_string_yields_no_phantom_crease() {
    assert_no_phantom("");
}

#[test]
fn obj_import_of_garbage_yields_no_phantom_crease() {
    assert_no_phantom("hello world\nthis is not an obj file\n# just a comment\n");
}
