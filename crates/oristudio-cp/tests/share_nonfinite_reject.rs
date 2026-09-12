//! F-005: the share encoder must never emit a payload its own decoder rejects.
//!
//! A document with non-finite coordinates used to slide through the lossless
//! `.fold` fallback, which returned `Ok` without running the self-check
//! (`attempt()`): `serde_json` serialises NaN as `null`, and the RAW decoder
//! rejects that, so `encode_share` handed back `Ok` (216 B,
//! `used_fallback: true`) for a dead link that `decode_share` refused with
//! `NotRepresentable`. Non-finite input must `Err` at encode time — never
//! Ok-then-decode-`Err`.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, Point};
use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{
    ShareError, ShareOptions, decode_share, encode_share, encode_share_reported,
};

/// Build a one-crease document carrying `x` as a coordinate directly, without
/// going through a text importer: importers are themselves entitled to reject
/// non-finite input (fmt-10), so the encoder fixture must not depend on one
/// accepting it. A non-finite coordinate can still reach the encoder from
/// in-memory construction, which is exactly the path under test.
fn nonfinite_document(x: f64) -> CreasePatternDocument {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(x, 0.0), Point::new(1.0, 1.0), LineColor::Black0);
    assert!(
        model
            .line_segments
            .iter()
            .flat_map(|s| [s.a.x, s.a.y, s.b.x, s.b.y])
            .any(|v| !v.is_finite()),
        "fixture must actually carry a non-finite coordinate",
    );
    CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    }
}

#[test]
fn encode_share_rejects_nan_instead_of_emitting_a_dead_link() {
    let document = nonfinite_document(f64::NAN);

    let err = encode_share(&document, ShareOptions::default())
        .expect_err("encode must reject non-finite coordinates, not emit an undecodable payload");
    assert!(
        matches!(err, ShareError::NotRepresentable(_)),
        "typed early error, got: {err}",
    );

    // The reported entry point must agree: no Ok payload, fallback or otherwise.
    let err = encode_share_reported(&document, ShareOptions::default())
        .expect_err("reported encode must also reject non-finite coordinates");
    assert!(
        matches!(err, ShareError::NotRepresentable(_)),
        "typed early error, got: {err}",
    );
}

#[test]
fn encode_share_rejects_infinite_coordinates() {
    let document = nonfinite_document(f64::INFINITY);

    let err = encode_share(&document, ShareOptions::default())
        .expect_err("encode must reject infinite coordinates");
    assert!(
        matches!(err, ShareError::NotRepresentable(_)),
        "typed early error, got: {err}",
    );
}

#[test]
fn finite_control_still_roundtrips() {
    let model = import_cp_str("1 0 0 1 1").expect("finite cp must parse");
    let document = CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    };

    let payload =
        encode_share(&document, ShareOptions::default()).expect("finite document must encode");
    let back = decode_share(&payload)
        .expect("finite payload must decode")
        .document;
    assert_eq!(
        back.crease_pattern.line_segments.len(),
        document.crease_pattern.line_segments.len(),
        "crease count must survive",
    );
    assert_eq!(
        back.crease_pattern.line_segments[0].color, document.crease_pattern.line_segments[0].color,
        "crease colour must survive",
    );
}
