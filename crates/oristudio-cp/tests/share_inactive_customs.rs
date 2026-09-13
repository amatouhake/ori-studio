//! C1: the encoder self-check must not compare state the compact codec
//! deliberately omits.
//!
//! The compact grammar carries a custom colour only for creases with
//! `customized != 0`; an *inactive* (`customized == 0`) crease keeps whatever
//! RGB it happened to retain (importers preserve it) and decodes to the
//! default. Comparing inactive RGB in `creases_match` therefore turns a
//! losslessly-carried document into a forced RAW fallback.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{ShareOptions, decode_share, encode_share_reported};

const STRAY: RgbColor = RgbColor::new(10, 20, 30);

fn seg(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

/// Nontrivial geometry on standard paper with a non-empty title. One crease
/// carries a retained-but-inactive custom colour, exactly as an importer can
/// leave behind.
fn stray_inactive_document() -> CreasePatternDocument {
    let mut model = CreasePatternModel::default();
    for (ax, ay, bx, by) in [
        (-200.0, -200.0, 200.0, -200.0),
        (200.0, -200.0, 200.0, 200.0),
        (200.0, 200.0, -200.0, 200.0),
        (-200.0, 200.0, -200.0, -200.0),
        (-200.0, -200.0, 200.0, 200.0),
        (-200.0, 200.0, 200.0, -200.0),
    ] {
        model.add_line_segment(seg(ax, ay, bx, by, LineColor::Black0));
    }
    let mut stray = seg(0.0, -200.0, 0.0, 200.0, LineColor::Red1);
    assert_eq!(
        stray.customized, 0,
        "fixture must leave the crease inactive"
    );
    stray.customized_color = STRAY;
    assert_ne!(
        stray.customized_color,
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(1.0, 1.0), LineColor::Red1)
            .customized_color,
        "fixture RGB must differ from the decoder default",
    );
    model.add_line_segment(stray);
    CreasePatternDocument {
        title: Some("inactive customs stay compact".to_string()),
        crease_pattern: model,
        ..Default::default()
    }
}

/// Transported semantics for an inactive crease: endpoints, colour, magnitude,
/// hint — never the uncarried RGB.
fn transported_key(s: &LineSegment) -> (u64, u64, u64, u64, i32) {
    let (a, b) = if (s.a.x, s.a.y) <= (s.b.x, s.b.y) {
        (s.a, s.b)
    } else {
        (s.b, s.a)
    };
    (
        a.x.to_bits(),
        a.y.to_bits(),
        b.x.to_bits(),
        b.y.to_bits(),
        s.color.number(),
    )
}

fn transported_geometry(model: &CreasePatternModel) -> Vec<(u64, u64, u64, u64, i32)> {
    let mut keys: Vec<_> = model.line_segments.iter().map(transported_key).collect();
    keys.sort_unstable();
    keys
}

#[test]
fn inactive_custom_colour_does_not_force_fallback() {
    let document = stray_inactive_document();
    let report = encode_share_reported(&document, ShareOptions::default()).expect("encode");
    assert!(
        !report.used_fallback,
        "compact carries everything here; inactive RGB must not force RAW fallback: {:?}",
        report.fallback_reason,
    );
}

#[test]
fn inactive_custom_colour_roundtrip_preserves_geometry_and_title() {
    let document = stray_inactive_document();
    let report = encode_share_reported(&document, ShareOptions::default()).expect("encode");
    let back = decode_share(&report.payload).expect("decode").document;
    assert_eq!(
        transported_geometry(&back.crease_pattern),
        transported_geometry(&document.crease_pattern),
        "geometry must survive",
    );
    assert_eq!(back.title, document.title, "title must survive");
}

#[test]
fn enabled_custom_colours_still_roundtrip() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(seg(-200.0, 0.0, 200.0, 0.0, LineColor::Black0));
    let enabled = seg(-200.0, -200.0, 200.0, 200.0, LineColor::Red1)
        .with_customized_color(RgbColor::new(1, 2, 3));
    model.add_line_segment(enabled);
    let document = CreasePatternDocument {
        title: Some("enabled customs".to_string()),
        crease_pattern: model,
        ..Default::default()
    };
    let report = encode_share_reported(&document, ShareOptions::default()).expect("encode");
    assert!(
        !report.used_fallback,
        "enabled customs are carried by the compact grammar: {:?}",
        report.fallback_reason,
    );
    let back = decode_share(&report.payload).expect("decode").document;
    let found = back
        .crease_pattern
        .line_segments
        .iter()
        .find(|s| s.customized != 0)
        .expect("enabled custom must survive the round trip");
    assert_eq!(
        found.customized_color,
        RgbColor::new(1, 2, 3),
        "enabled RGB must survive exactly",
    );
    assert_eq!(back.title, document.title, "title must survive");
}
