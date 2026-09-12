//! The encoder self-check must see hints and custom colours.
//!
//! `verify::creases_match` is the gate behind "never emit a payload we have
//! not decoded and checked ourselves". Its multiset key omitted
//! `fold_direction_hint`, `customized` and `customized_color`, so an encoding
//! that silently dropped the hint/custom-colour extensions still matched the
//! source and the self-check waved it through.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::verify::creases_match;
use oristudio_cp::share::{ShareOptions, decode_share, encode_share};

fn seg(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn hinted(ax: f64, ay: f64, bx: f64, by: f64, hint: FoldDirection) -> LineSegment {
    seg(ax, ay, bx, by, LineColor::None).with_direction_hint(Some(hint))
}

#[test]
fn stripped_hint_no_longer_matches_the_full_document() {
    let full = vec![
        seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1),
        hinted(0.0, 0.0, 0.0, 100.0, FoldDirection::Mountain),
    ];
    let stripped = vec![
        seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1),
        seg(0.0, 0.0, 0.0, 100.0, LineColor::None),
    ];
    assert!(
        !creases_match(&full, &stripped),
        "a payload that dropped the hint extension must not match"
    );
}

#[test]
fn stripped_custom_colour_no_longer_matches_the_full_document() {
    let mut custom = seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1);
    custom.customized = 1;
    custom.customized_color = RgbColor::new(1, 2, 3);
    let full = vec![custom];
    let stripped = vec![seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1)];
    assert!(
        !creases_match(&full, &stripped),
        "a payload that dropped the custom-colour extension must not match"
    );
}

#[test]
fn identical_documents_still_match() {
    let doc = vec![
        seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1),
        hinted(0.0, 0.0, 0.0, 100.0, FoldDirection::Valley),
    ];
    assert!(creases_match(&doc, &doc.clone()));
}

#[test]
fn honest_hints_and_custom_colours_still_roundtrip() {
    let mut model = CreasePatternModel::default();
    model
        .line_segments
        .push(seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1));
    model
        .line_segments
        .push(hinted(0.0, 0.0, 0.0, 100.0, FoldDirection::Mountain));
    let mut custom = seg(0.0, 0.0, 100.0, 100.0, LineColor::Blue2);
    custom.customized = 1;
    custom.customized_color = RgbColor::new(9, 8, 7);
    model.line_segments.push(custom);

    let document = CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    };
    let payload = encode_share(&document, ShareOptions::default()).expect("encode");
    let back = decode_share(&payload)
        .expect("decode")
        .document
        .crease_pattern;
    assert_eq!(back.line_segments.len(), 3);
    let hints: Vec<_> = back
        .line_segments
        .iter()
        .map(|s| s.fold_direction_hint)
        .collect();
    assert!(
        hints.contains(&Some(FoldDirection::Mountain)),
        "hint survived: {hints:?}"
    );
    let hit = back
        .line_segments
        .iter()
        .find(|s| s.customized != 0)
        .expect("custom colour survived");
    assert_eq!(hit.customized_color, RgbColor::new(9, 8, 7));
}
