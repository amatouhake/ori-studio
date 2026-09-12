//! ORH phantom regression (upstream #368, F-004 + ORH half of F-006).
//!
//! `import_orh_str` preallocated `vec![default; num_lines + 1]` with no tail
//! truncation, so every import carried one phantom segment and one phantom
//! circle. Export wrote the phantoms as real rows and the next import added
//! another: counts grew +1 per cycle and empty/garbage input imported as
//! `Ok(1 seg + 1 circle)` instead of `Ok(empty)` / `Err`.

use oristudio_cp::io::orh;

fn counts(document: &oristudio_cp::CreasePatternDocument) -> (usize, usize) {
    (
        document.crease_pattern.line_segments.len(),
        document.crease_pattern.circles.len(),
    )
}

fn assert_no_phantom(input: &str, label: &str) {
    match orh::import_orh_str(input) {
        Err(_) => {}
        Ok(document) => {
            let (segs, circs) = counts(&document);
            assert_eq!(
                (segs, circs),
                (0, 0),
                "{label}: expected Ok(empty) or Err, got Ok({segs} seg + {circs} circle phantom)"
            );
        }
    }
}

#[test]
fn orh_empty_import_has_no_phantom() {
    assert_no_phantom("", "empty ORH");
}

#[test]
fn orh_garbage_import_has_no_phantom() {
    assert_no_phantom(
        "this is not an orh file\njust some junk, with commas\n<random>xml?</random>\n",
        "garbage ORH",
    );
}

#[test]
fn orh_empty_roundtrip_is_stable() {
    let first = orh::import_orh_str("").expect("empty ORH imports");
    let c0 = counts(&first);
    assert_eq!(c0, (0, 0), "empty ORH imports as phantom {c0:?}");
    let second = orh::import_orh_str(&orh::export_orh_string(&first)).expect("reimport");
    let third =
        orh::import_orh_str(&orh::export_orh_string(&second)).expect("third import");
    assert_eq!(
        (c0, counts(&second), counts(&third)),
        (c0, c0, c0),
        "empty ORH round trip grows per cycle"
    );
}

const ONE_SEG_ONE_CIRCLE: &str = "\
<タイトル>
タイトル,minimal
<線分集合>
番号,1
色,1
iactive,ACTIVE_BOTH_3
選択,0
座標,0.0,0.0,10.0,0.0
<円集合>
番号,1
中心と半径と色,5.0,5.0,2.0,3
";

#[test]
fn orh_single_entry_roundtrip_is_stable() {
    let first = orh::import_orh_str(ONE_SEG_ONE_CIRCLE).expect("minimal ORH imports");
    let c0 = counts(&first);
    assert_eq!(c0, (1, 1), "1-seg/1-circle ORH imports as {c0:?}");
    let second = orh::import_orh_str(&orh::export_orh_string(&first)).expect("reimport");
    let third =
        orh::import_orh_str(&orh::export_orh_string(&second)).expect("third import");
    assert_eq!(
        (counts(&second), counts(&third)),
        (c0, c0),
        "1-seg/1-circle ORH round trip grows per cycle"
    );
}

#[test]
fn orh_repo_fixture_roundtrip_is_stable() {
    let fixture = include_str!("../../../tests/fixtures/oriedita/folded_view_colors.orh");
    let first = orh::import_orh_str(fixture).expect("fixture imports");
    // The fixture declares one segment (`番号,1`) and no circles.
    let c0 = counts(&first);
    assert_eq!(c0, (1, 0), "fixture imports as {c0:?}");
    let second = orh::import_orh_str(&orh::export_orh_string(&first)).expect("reimport");
    let third =
        orh::import_orh_str(&orh::export_orh_string(&second)).expect("third import");
    assert_eq!(
        (counts(&second), counts(&third)),
        (c0, c0),
        "fixture round trip grows per cycle"
    );
}
