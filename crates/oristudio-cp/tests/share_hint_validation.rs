//! fmt-06: fold-direction-hint arrays must match the creases exactly.
//!
//! The decoder never compared the hint count against the crease count (short
//! arrays silently left creases unhinted via a `get_mut` skip, long arrays
//! dropped the extras) and mapped the reserved code `3` to `None`. The
//! honest encoder always writes one code per crease with codes 0-2, so
//! requiring `count == ne` and rejecting code 3 never fires honestly.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{ShareError, ShareOptions, decode_share, encode_share};

fn hinted(ax: f64, ay: f64, bx: f64, by: f64, hint: FoldDirection) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), LineColor::None)
        .with_direction_hint(Some(hint))
}

fn hinted_document() -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    model
        .line_segments
        .push(hinted(0.0, 0.0, 100.0, 0.0, FoldDirection::Mountain));
    model
        .line_segments
        .push(hinted(0.0, 0.0, 0.0, 100.0, FoldDirection::Valley));
    model
        .line_segments
        .push(hinted(0.0, 0.0, 100.0, 100.0, FoldDirection::Mountain));
    model
        .line_segments
        .push(hinted(100.0, 0.0, 100.0, 100.0, FoldDirection::Valley));
    model
}

/// Honest body for the document above: its only extension is the hint TLV,
/// so the body ends with
/// `[n_ext=1][tag 0x8003][len][count=4][packed]`.
fn honest_body() -> Vec<u8> {
    let body = oristudio_cp::share::v1::encode(&hinted_document(), None, 36, 36).expect("encode");
    let n = body.len();
    assert!(
        n > 7 && body[n - 7] == 1 && body[n - 6..n - 3] == [0x83, 0x80, 0x02],
        "single-extension tail layout assumed by the forgeries below"
    );
    assert_eq!(body[n - 3], 2, "hint payload is count + one packed byte");
    assert_eq!(body[n - 2], 4, "honest count matches the 4 creases");
    body
}

/// Replace the trailing `[count][packed..]` of the honest body. `len` is the
/// new payload length; the length byte sits just before the old payload.
fn with_hint_payload(new_payload: &[u8]) -> Vec<u8> {
    let body = honest_body();
    let n = body.len();
    let mut forged = body[..n - 3].to_vec();
    forged.push(new_payload.len() as u8);
    forged.extend_from_slice(new_payload);
    forged
}

fn assert_hint_rejected(body: Vec<u8>, case: &str) {
    let err = match oristudio_cp::share::v1::decode(&body) {
        Ok(_) => panic!("hint {case} must be rejected"),
        Err(err) => err,
    };
    assert!(
        matches!(err, ShareError::MalformedExtension { tag: 0x8003, .. }),
        "hint {case} is a malformed extension, got: {err}"
    );
}

#[test]
fn short_hint_count_is_rejected() {
    let packed = honest_body().pop().expect("packed byte");
    assert_hint_rejected(with_hint_payload(&[2, packed]), "count=2 of 4");
}

#[test]
fn long_hint_count_is_rejected() {
    let packed = honest_body().pop().expect("packed byte");
    assert_hint_rejected(with_hint_payload(&[6, packed, 0x00]), "count=6 of 4");
}

#[test]
fn reserved_hint_code_3_is_rejected() {
    let packed = honest_body().pop().expect("packed byte");
    assert_hint_rejected(with_hint_payload(&[4, packed | 0x03]), "code 3");
}

#[test]
fn honest_hints_still_roundtrip() {
    let body = honest_body();
    let decoded = oristudio_cp::share::v1::decode(&body).expect("decode");
    // Decoded segments are in canonical block order, not insertion order, so
    // compare as a multiset.
    let mut hints: Vec<u8> = decoded
        .model
        .line_segments
        .iter()
        .map(|s| match s.fold_direction_hint {
            None => 0,
            Some(FoldDirection::Mountain) => 1,
            Some(FoldDirection::Valley) => 2,
        })
        .collect();
    hints.sort_unstable();
    assert_eq!(hints, vec![1, 1, 2, 2]);

    let document = CreasePatternDocument {
        crease_pattern: hinted_document(),
        ..Default::default()
    };
    let payload = encode_share(&document, ShareOptions::default()).expect("encode");
    let back = decode_share(&payload)
        .expect("decode")
        .document
        .crease_pattern;
    assert_eq!(back.line_segments.len(), 4);
    assert!(
        back.line_segments
            .iter()
            .all(|s| s.fold_direction_hint.is_some()),
        "all hints survived the full share round trip"
    );
}
