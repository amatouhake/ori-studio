//! C2: the RAW fallback must preserve share semantics, not merely decode.
//!
//! A RAW body round-trips through the ordinary FOLD importer, which normalizes
//! geometry, returns no title, and keeps only the fields FOLD itself carries.
//! Checking only `v1::decode(raw)` success therefore emitted links that moved
//! geometry and silently dropped content. Fallback is forced deterministically
//! with `max_rounds: 0`; every field share links promise either survives or
//! encoding fails with a typed [`ShareError::SelfCheck`] — never silently
//! changed content.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{
    Circle, FoldDirection, FoldMagnitude, LineColor, LineSegment, Point, RgbColor,
};
use oristudio_cp::io::fold::{export_fold_file_document_json, import_fold_json};
use oristudio_cp::model::{CreasePatternModel, GridState, TextElement};
use oristudio_cp::share::{ShareError, ShareOptions, decode_share, encode_share_reported};

fn forced_fallback() -> ShareOptions {
    ShareOptions {
        verify_diagnostics: true,
        max_rounds: 0,
    }
}

fn seg(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn square() -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    for (ax, ay, bx, by) in [
        (-200.0, -200.0, 200.0, -200.0),
        (200.0, -200.0, 200.0, 200.0),
        (200.0, 200.0, -200.0, 200.0),
        (-200.0, 200.0, -200.0, -200.0),
        (-200.0, -200.0, 200.0, 200.0),
    ] {
        model.add_line_segment(seg(ax, ay, bx, by, LineColor::Black0));
    }
    model
}

fn doc(model: CreasePatternModel) -> CreasePatternDocument {
    CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    }
}

/// Forced-fallback round trip; asserts the fallback actually ran.
fn fallback_roundtrip(document: &CreasePatternDocument) -> CreasePatternDocument {
    let report =
        encode_share_reported(document, forced_fallback()).expect("fallback must encode here");
    assert!(
        report.used_fallback,
        "max_rounds: 0 must force the RAW fallback"
    );
    decode_share(&report.payload)
        .expect("fallback payload must decode")
        .document
}

fn fallback_err(document: &CreasePatternDocument) -> (&'static str, usize) {
    match encode_share_reported(document, forced_fallback()) {
        Ok(report) => panic!(
            "fallback must refuse to emit silently-changed content (used_fallback={})",
            report.used_fallback,
        ),
        Err(ShareError::SelfCheck { reason, rounds }) => (reason, rounds),
        Err(other) => panic!("typed SelfCheck error, got: {other:?}"),
    }
}

fn crease_signature(model: &CreasePatternModel) -> Vec<(u64, u64, u64, u64, i32, u32)> {
    let mut keys: Vec<_> = model
        .line_segments
        .iter()
        .map(|s| {
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
                FoldMagnitude::to_transport(s.fold_magnitude),
            )
        })
        .collect();
    keys.sort_unstable();
    keys
}

#[test]
fn fallback_preserves_standard_geometry_colours_and_magnitudes() {
    let mut model = square();
    model.line_segments[0] =
        seg(-200.0, -200.0, 200.0, -200.0, LineColor::Red1).with_direction_hint(None);
    model.line_segments[1] = seg(200.0, -200.0, 200.0, 200.0, LineColor::Blue2);
    model.add_line_segment(
        seg(-200.0, 50.0, 200.0, 50.0, LineColor::Red1)
            .with_fold_magnitude(FoldMagnitude::from_degrees(90.0)),
    );
    let document = doc(model);
    let back = fallback_roundtrip(&document);
    assert_eq!(
        crease_signature(&back.crease_pattern),
        crease_signature(&document.crease_pattern),
        "geometry, colours and magnitudes must survive",
    );
    assert_eq!(back.title, None, "untitled stays untitled");
}

#[test]
fn fallback_normalizes_shifted_geometry_like_fold_open() {
    // A 100x100 square at the origin: FOLD import scales it onto the standard
    // paper box, so the fallback recipient sees the normalized pattern —
    // exactly what opening the same bytes as a `.fold` file shows.
    let mut model = CreasePatternModel::default();
    for (ax, ay, bx, by) in [
        (0.0, 0.0, 100.0, 0.0),
        (100.0, 0.0, 100.0, 100.0),
        (100.0, 100.0, 0.0, 100.0),
        (0.0, 100.0, 0.0, 0.0),
    ] {
        model.add_line_segment(seg(ax, ay, bx, by, LineColor::Black0));
    }
    let document = doc(model);
    let back = fallback_roundtrip(&document);
    let first = &back.crease_pattern.line_segments[0];
    assert!(
        (first.a.x, first.a.y, first.b.x, first.b.y) != (0.0, 0.0, 100.0, 0.0),
        "the FOLD normalization genuinely moves this geometry",
    );
    let oracle = import_fold_json(&export_fold_file_document_json(&document).expect("export"))
        .expect("oracle import");
    assert_eq!(
        back.crease_pattern, oracle,
        "fallback decodes to exactly what the same .fold file opens as",
    );
}

#[test]
fn fallback_preserves_hints_customs_texts_circles_and_grid() {
    let mut model = square();
    // Hints survive beside unassigned creases, where FOLD carries them.
    model.add_line_segment(
        seg(-200.0, 0.0, 200.0, 0.0, LineColor::None)
            .with_direction_hint(Some(FoldDirection::Valley)),
    );
    // Enabled custom colours round-trip exactly ...
    model.add_line_segment(
        seg(0.0, -200.0, 0.0, 200.0, LineColor::Red1).with_customized_color(RgbColor::new(1, 2, 3)),
    );
    // ... while an inactive retained RGB is not transported and must not fail.
    let mut stray = seg(-150.0, -200.0, -150.0, 200.0, LineColor::Blue2);
    stray.customized_color = RgbColor::new(9, 9, 9);
    model.add_line_segment(stray);
    model.add_text(TextElement::new(12.5, -37.25, "hello-fold"));
    model.add_circle(Circle::new(50.0, 60.0, 70.0, LineColor::Green6));
    model.add_circle(
        Circle::new(-50.0, -60.0, 30.0, LineColor::Green6)
            .with_customized_color(RgbColor::new(4, 5, 6)),
    );
    model.grid.set_grid_size(16);
    model.grid.base_state = GridState::Full;
    let document = doc(model);
    let back = fallback_roundtrip(&document);

    let hint = back
        .crease_pattern
        .line_segments
        .iter()
        .find(|s| s.color == LineColor::None)
        .expect("unassigned crease must survive");
    assert_eq!(hint.fold_direction_hint, Some(FoldDirection::Valley));
    let custom = back
        .crease_pattern
        .line_segments
        .iter()
        .find(|s| s.customized != 0)
        .expect("enabled custom must survive");
    assert_eq!(custom.customized_color, RgbColor::new(1, 2, 3));

    assert_eq!(back.crease_pattern.texts, document.crease_pattern.texts);
    assert_eq!(back.crease_pattern.circles, document.crease_pattern.circles);
    assert_eq!(back.crease_pattern.grid, document.crease_pattern.grid);
}
#[test]
fn fallback_rejects_hint_on_decided_crease() {
    // FOLD keeps a hint only beside an unassigned crease; a hint on a decided
    // crease would vanish, so the fallback refuses instead. Builders and
    // importers uphold the unassigned-only invariant themselves, so the state
    // is forced structurally here to prove the fallback check guards it.
    let base = seg(-200.0, 0.0, 200.0, 0.0, LineColor::Red1);
    assert_eq!(base.fold_direction_hint, None);
    let mut model = square();
    model.add_line_segment(LineSegment {
        fold_direction_hint: Some(FoldDirection::Mountain),
        ..base
    });
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(
        reason,
        "fallback changed crease geometry, colours, hints, customs or magnitudes"
    );
}

#[test]
fn fallback_rejects_titled_document() {
    let mut document = doc(square());
    document.title = Some("a title RAW cannot carry".to_string());
    let (reason, _) = fallback_err(&document);
    assert_eq!(reason, "fallback dropped the title");
}

#[test]
fn fallback_rejects_aux_segments() {
    let mut model = square();
    model.add_aux_line_segment(seg(-100.0, 0.0, 100.0, 0.0, LineColor::Cyan3));
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(reason, "fallback dropped aux segments");
}

#[test]
fn fallback_rejects_standalone_points() {
    let mut model = square();
    model.add_point(Point::new(10.0, 20.0));
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(reason, "fallback dropped standalone points");
}

#[test]
fn fallback_rejects_nonstandard_customized_spelling() {
    // FOLD round-trips a custom colour only for `customized == 1`; any other
    // nonzero spelling is dropped on export, so the fallback refuses instead.
    let mut model = square();
    let mut custom = seg(-200.0, 0.0, 200.0, 0.0, LineColor::Blue2);
    custom.customized = 2;
    custom.customized_color = RgbColor::new(7, 8, 9);
    model.add_line_segment(custom);
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(
        reason,
        "fallback changed crease geometry, colours, hints, customs or magnitudes"
    );
}

#[test]
fn fallback_rejects_full_angle_magnitude() {
    // A full +/-180 magnitude imports as classic `None`; an explicit one would
    // silently become classic, so the fallback refuses instead. The builder
    // normalizes 180 to `None` itself, so the state is forced structurally
    // here to prove the fallback check guards it.
    let full = FoldMagnitude::from_degrees(180.0).expect("180 is representable");
    assert!(full.is_full());
    let base = seg(-200.0, 50.0, 200.0, 50.0, LineColor::Red1);
    assert_eq!(base.fold_magnitude, None);
    let mut model = square();
    model.add_line_segment(LineSegment {
        fold_magnitude: Some(full),
        ..base
    });
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(
        reason,
        "fallback changed crease geometry, colours, hints, customs or magnitudes"
    );
}

#[test]
fn fallback_rejects_exotic_grid() {
    // FOLD carries grid size and style only; any other grid field would reset
    // to its default, so the fallback refuses instead.
    let mut model = square();
    model.grid.set_grid_angle(60.0);
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(reason, "fallback changed the grid");
}

#[test]
fn fallback_rejects_empty_document() {
    // With no edges the FOLD exporter substitutes a degenerate dummy segment,
    // whose zero-height import bounds scale by infinity: the RAW decode is a
    // single NaN crease. Refuse instead of emitting it.
    let (reason, _) = fallback_err(&doc(CreasePatternModel::default()));
    assert_eq!(reason, "fallback produced non-finite geometry");
}

#[test]
fn fallback_rejects_degenerate_flat_document() {
    // Every vertex on one horizontal line collapses the import bounds the same
    // way: infinite scale, non-finite decode. Refuse instead of emitting it.
    let mut model = CreasePatternModel::default();
    model.add_line_segment(seg(-200.0, 0.0, 200.0, 0.0, LineColor::Black0));
    let (reason, _) = fallback_err(&doc(model));
    assert_eq!(reason, "fallback produced non-finite geometry");
}
