//! `CreaseAdvanceType` through the command dispatch — the menu/Apply path.
//!
//! The kernel op (`operations::color::advance_line_type`) is the single-click
//! cycle shared with the click tool: it removes the line at `index` and
//! re-appends it, and `selected` is cycle *state* (`Black0/0 -> Black0/2 ->
//! Red1/0 -> Blue2/0 -> ...`), so genuinely-selected mountains/valleys hit the
//! `_ => segment` arm. Composing that op as a batch menu action over explicit
//! `line_ids` broke two ways:
//!
//! A. Stale-index misrouting: the dispatch pre-resolved every positional index
//!    once, then each call's remove+append shifted the rest. Ids {1,2,3} on
//!    [A,B,C,D] advanced A twice, C once (colour untouched), B never, while
//!    the diagnostic still claimed `Changed 3`.
//!
//! B. Selected-M/V silent no-op with a lying count: after a real
//!    `CreaseSelect` (which stamps `selected = 2`), every mountain/valley
//!    fell into `_ => segment` — zero colour change, still reordered, still
//!    counted.
//!
//! `line_ids` is **one-based** here, and lines are identified by geometry
//! below because the op re-appends (order is not stable across the call).

use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    execute_command,
};

/// Horizontal segments stacked one unit apart, so each line keeps its
/// identity (`a.y`) across the remove+append reorder.
fn document_with(colors: &[LineColor]) -> CreasePatternDocument {
    let mut crease_pattern = CreasePatternModel::default();
    crease_pattern.line_segments.clear();
    for (index, color) in colors.iter().enumerate() {
        let offset = index as f64;
        crease_pattern.line_segments.push(
            LineSegment::new(Point::new(0.0, offset), Point::new(10.0, offset))
                .with_line_color(*color),
        );
    }
    CreasePatternDocument {
        crease_pattern,
        ..CreasePatternDocument::default()
    }
}

/// The count **as the caller receives it** — `CommandResult` carries no numeric
/// field, so the `"Changed N line(s)"` diagnostic is the only channel the web has.
fn changed(result: oristudio_cp::CommandResult) -> usize {
    let reported = result.diagnostics.first().expect("a changed-count message");
    reported
        .strip_prefix("Changed ")
        .and_then(|rest| rest.strip_suffix(" line(s)"))
        .unwrap_or_else(|| panic!("unexpected result message {reported:?}"))
        .parse()
        .expect("a number")
}

fn advance(document: &mut CreasePatternDocument, line_ids: &[usize]) -> usize {
    changed(
        execute_command(
            document,
            CreasePatternCommand::new(OperationId::CreaseAdvanceType).with_payload(
                CreasePatternCommandPayload {
                    line_ids: line_ids.to_vec(),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("CreaseAdvanceType is supported"),
    )
}

fn select(document: &mut CreasePatternDocument, line_ids: &[usize]) -> usize {
    changed(
        execute_command(
            document,
            CreasePatternCommand::new(OperationId::CreaseSelect).with_payload(
                CreasePatternCommandPayload {
                    line_ids: line_ids.to_vec(),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("CreaseSelect is supported"),
    )
}

fn color_at_y(document: &CreasePatternDocument, y: f64) -> LineColor {
    document
        .crease_pattern
        .line_segments
        .iter()
        .find(|segment| segment.a.y == y && segment.b.y == y)
        .unwrap_or_else(|| panic!("a line at y={y}"))
        .color
}

/// Facet A: a multi-id advance must reach exactly the targeted lines, once
/// each, and leave untargeted lines alone — not replay stale positional
/// indices across the per-call remove+append.
#[test]
fn multi_id_advance_reaches_each_targeted_line_once() {
    let mut document = document_with(&[
        LineColor::Red1,
        LineColor::Blue2,
        LineColor::Black0,
        LineColor::Black0,
    ]);

    let reported = advance(&mut document, &[1, 2, 3]);

    assert_eq!(reported, 3);
    assert_eq!(document.crease_pattern.line_segments.len(), 4);
    assert_eq!(color_at_y(&document, 0.0), LineColor::Blue2);
    assert_eq!(color_at_y(&document, 1.0), LineColor::Black0);
    assert_eq!(color_at_y(&document, 2.0), LineColor::Red1);
    // Untargeted: never advanced, never reordered into the count.
    assert_eq!(color_at_y(&document, 3.0), LineColor::Black0);
}

/// Facet B: the real menu chain — `CreaseSelect` stamps `selected = 2`, and a
/// following advance over those ids must still move mountain/valley creases
/// through the edge/mountain/valley cycle with an honest count.
#[test]
fn select_then_advance_moves_selected_mountain_and_valley() {
    let mut document = document_with(&[LineColor::Red1, LineColor::Blue2]);

    select(&mut document, &[1, 2]);
    assert!(
        document
            .crease_pattern
            .line_segments
            .iter()
            .all(|segment| segment.selected == 2),
        "the select step stamps selected = 2, which is the premise of this test"
    );

    let reported = advance(&mut document, &[1, 2]);

    assert_eq!(reported, 2);
    assert_eq!(color_at_y(&document, 0.0), LineColor::Blue2);
    assert_eq!(color_at_y(&document, 1.0), LineColor::Black0);
}

/// The count names only lines whose colour actually moved: a selected edge
/// still steps into the cycle, while an auxiliary line has no next type and
/// must neither change nor be counted.
#[test]
fn advance_counts_only_lines_whose_colour_changed() {
    let mut document = document_with(&[LineColor::Black0, LineColor::Cyan3]);

    select(&mut document, &[1, 2]);
    let reported = advance(&mut document, &[1, 2]);

    assert_eq!(reported, 1);
    assert_eq!(color_at_y(&document, 0.0), LineColor::Red1);
    assert_eq!(color_at_y(&document, 1.0), LineColor::Cyan3);
}
