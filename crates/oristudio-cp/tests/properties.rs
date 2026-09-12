//! Bounded, deterministic invariants complement the committed upstream goldens.
//! Deliberately excludes FOLD normalization and ORH (#366, #367, #368).

use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::io::{IoError, cp};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::operations::native::pinned::PinnedPoints;
use oristudio_cp::operations::transform::transform_segments_by_points;
use proptest::prelude::*;
use proptest::test_runner::{FileFailurePersistence, RngSeed};

fn point() -> impl Strategy<Value = Point> {
    (-4000i32..=4000, -4000i32..=4000)
        .prop_map(|(x, y)| Point::new(f64::from(x) / 4.0, f64::from(y) / 4.0))
}

fn pair() -> impl Strategy<Value = (Point, Point)> {
    (
        point(),
        (-50i32..=50, -50i32..=50).prop_filter("nonzero direction", |&(x, y)| x != 0 || y != 0),
    )
        .prop_map(|(a, (x, y))| (a, Point::new(a.x + f64::from(x), a.y + f64::from(y))))
}

fn segment() -> impl Strategy<Value = LineSegment> {
    (point(), point(), 1i32..=4).prop_map(|(a, b, assignment)| {
        LineSegment::with_color(a, b, cp::cp_assignment_to_line_color(assignment).unwrap())
    })
}

// Codec cases include non-dyadic decimals and very small values as well as
// integers. Transform probes use the quarter grid above to bound conditioning.
fn cp_segment() -> impl Strategy<Value = LineSegment> {
    (
        -1.0e6f64..1.0e6,
        -1.0e6f64..1.0e6,
        -1.0e6f64..1.0e6,
        -1.0e6f64..1.0e6,
        1i32..=4,
    )
        .prop_map(|(ax, ay, bx, by, assignment)| {
            LineSegment::with_color(
                Point::new(ax, ay),
                Point::new(bx, by),
                cp::cp_assignment_to_line_color(assignment).unwrap(),
            )
        })
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        rng_seed: RngSeed::Fixed(20260912),
        // Integration tests have no adjacent lib.rs. Keep failures beside this
        // source, and commit any resulting .proptest-regressions file.
        failure_persistence: Some(Box::new(FileFailurePersistence::WithSource("proptest-regressions"))),
        .. ProptestConfig::default()
    })]

    #[test]
    fn cp_roundtrip_preserves_order_endpoints_and_assignments(
        segments in prop::collection::vec(cp_segment(), 0..40),
    ) {
        let model = CreasePatternModel { line_segments: segments, ..Default::default() };
        let text = cp::export_cp_string(&model);
        let parsed = cp::import_cp_str(&text)?;
        prop_assert_eq!(&parsed.line_segments, &model.line_segments);
        prop_assert_eq!(cp::export_cp_string(&parsed), text);
    }

    #[test]
    fn cp_accepts_whitespace_without_changing_geometry(
        segments in prop::collection::vec(cp_segment(), 0..40),
        separator in prop::sample::select(vec![" ", "\t", "  \t "]),
        newline in prop::sample::select(vec!["\n", "\r\n"]),
    ) {
        let model = CreasePatternModel { line_segments: segments, ..Default::default() };
        let text = cp::export_cp_string(&model);
        let decorated = text.lines().map(|line| {
            format!("{separator}{}{separator}{newline}{newline}", line.split_whitespace().collect::<Vec<_>>().join(separator))
        }).collect::<String>();
        prop_assert_eq!(cp::import_cp_str(&decorated)?.line_segments, model.line_segments);
    }

    #[test]
    fn cp_bad_numeric_tokens_report_the_physical_line(
        segments in prop::collection::vec(cp_segment(), 0..20),
        blanks in 0usize..8,
        column in 0usize..5,
    ) {
        let model = CreasePatternModel { line_segments: segments, ..Default::default() };
        let mut text = cp::export_cp_string(&model);
        text.push_str(&"\n".repeat(blanks));
        let mut tokens = ["1", "0", "0", "1", "1"];
        tokens[column] = "invalid";
        text.push_str(&tokens.join(" "));
        let error = cp::import_cp_str(&text).unwrap_err();
        let correct_line = matches!(error, IoError::InvalidLine { format: "cp", line, .. }
            if line == model.line_segments.len() + blanks + 1);
        prop_assert!(correct_line, "{error:?}");
    }

    #[test]
    fn similarity_maps_endpoints_scales_lengths_and_inverts(
        (a, b) in pair(), (c, d) in pair(), probe in segment(),
    ) {
        let mut segments = vec![LineSegment::with_color(a, b, LineColor::Red1), probe.clone()];
        transform_segments_by_points(&mut segments, a, b, c, d, PinnedPoints::none());
        prop_assert!(segments[0].a.distance(c) < 1e-7, "{:?} != {c:?}", segments[0].a);
        prop_assert!(segments[0].b.distance(d) < 1e-7, "{:?} != {d:?}", segments[0].b);
        let expected = probe.a.distance(probe.b) * c.distance(d) / a.distance(b);
        let actual = segments[1].a.distance(segments[1].b);
        prop_assert!((actual - expected).abs() < 1e-9 * (1.0 + expected), "{actual} != {expected}");
        prop_assert_eq!(segments[1].color, probe.color);
        transform_segments_by_points(&mut segments, c, d, a, b, PinnedPoints::none());
        prop_assert!(segments[1].a.distance(probe.a) < 1e-7);
        prop_assert!(segments[1].b.distance(probe.b) < 1e-7);
    }

    #[test]
    fn pinned_junction_stays_exact_while_free_endpoints_follow_the_transform(
        (a, b) in pair(), (c, d) in pair(), junction in point(), p in point(), q in point(),
    ) {
        let mut held = vec![
            LineSegment::with_color(junction, p, LineColor::Red1),
            LineSegment::with_color(q, junction, LineColor::Blue2),
        ];
        let mut free = held.clone();
        transform_segments_by_points(&mut free, a, b, c, d, PinnedPoints::none());
        transform_segments_by_points(&mut held, a, b, c, d, PinnedPoints::new(&[junction]));
        prop_assert_eq!(held[0].a, junction);
        prop_assert_eq!(held[1].b, junction);
        // Quarter-grid points either coincide exactly or are well beyond the
        // pin tolerance. Coincident generated endpoints are junctions too.
        prop_assert_eq!(held[0].b, if p == junction { junction } else { free[0].b });
        prop_assert_eq!(held[1].a, if q == junction { junction } else { free[1].a });
    }
}
