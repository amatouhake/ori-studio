//! Share extension canonicality: every known extension arm must consume its
//! declared payload exactly.
//!
//! Audit verdicts against `v1::decode` at UPSTREAM_BASE (`c6c7e94d`):
//!
//! | arm | verdict | reason |
//! |-----|---------|--------|
//! | `TAG_TITLE` (0x0001) | n/a | No inner cursor: the whole payload *is* the UTF-8 title, so extra bytes change the title (or fail UTF-8) rather than being ignored. Pinned by `title_payload_has_no_trailing_concept`. |
//! | `TAG_GRID` (0x0002) | n/a here | Owned by the grid-validation branch; untouched. |
//! | `TAG_AUX` (0x0003) | fixed | `read_block` returns after the block; trailing bytes decoded as `Ok` and were ignored. |
//! | `TAG_CIRCLES`/`TAG_TEXTS` (0x0004/0x0005) | n/a here | Owned by the circle-validation branch; untouched. |
//! | `TAG_FOLD_MAGNITUDE` (0x8001) | fixed | `decode_fold_magnitudes` never checked its inner cursor was exhausted, on either the sparse or the dense path. |
//! | `TAG_CUSTOM_COLOUR` (0x8002) | fixed | The index/rgb loop never checked for trailing bytes. |
//! | `TAG_FOLD_DIRECTION_HINT` (0x8003) | n/a here | Owned by the hint-validation branch; untouched. |
//! | unknown ancillary tag | n/a by design | Skipped and counted; control in `unknown_ancillary_tag_still_skips`. |
//!
//! Each `*_trailing_is_rejected` test below FAILS on the unmodified decoder
//! (the forgery decodes as `Ok`) and passes after the fix.

use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{ShareError, v1};

fn write_uvarint(mut v: u64, out: &mut Vec<u8>) {
    loop {
        let byte = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(byte);
            break;
        }
        out.push(byte | 0x80);
    }
}

fn read_uvarint(bytes: &[u8]) -> (u64, usize) {
    let mut value = 0u64;
    let mut shift = 0u32;
    for (i, &b) in bytes.iter().enumerate() {
        value |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return (value, i + 1);
        }
        shift += 7;
    }
    panic!("unterminated varint in test fixture");
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), LineColor::Red1)
}

fn base_model() -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    model.line_segments.push(segment(0.0, 0.0, 100.0, 0.0));
    model
}

/// Encode `with` and `without` (identical main content, differing only by the
/// extension under test) and split the honest single-extension body into its
/// head (everything through the tag varint) and payload. Asserts the
/// extension does not alter the shared block prefix, so the split is exact
/// regardless of varint widths.
fn single_extension_parts(
    with: CreasePatternModel,
    without: &CreasePatternModel,
    title_with: Option<&str>,
    title_without: Option<&str>,
    tag: u16,
) -> (Vec<u8>, Vec<u8>) {
    let honest = v1::encode(&with, title_with, 36, 36).expect("honest encode");
    let baseline = v1::encode(without, title_without, 36, 36).expect("baseline encode");
    let prefix_len = baseline.len() - 1;
    assert_eq!(
        baseline[prefix_len], 0,
        "baseline carries no extensions: hidden fixture drift"
    );
    assert_eq!(
        &honest[..prefix_len],
        &baseline[..prefix_len],
        "extension must not alter the block prefix"
    );
    assert_eq!(
        honest[prefix_len], 1,
        "honest body carries exactly one extension"
    );
    let (got_tag, tag_len) = read_uvarint(&honest[prefix_len + 1..]);
    assert_eq!(
        got_tag,
        u64::from(tag),
        "single extension has the expected tag"
    );
    let len_pos = prefix_len + 1 + tag_len;
    let (len, len_len) = read_uvarint(&honest[len_pos..]);
    let payload_start = len_pos + len_len;
    assert_eq!(
        payload_start + len as usize,
        honest.len(),
        "payload runs to the end of the honest body"
    );
    (honest[..len_pos].to_vec(), honest[payload_start..].to_vec())
}

/// Re-emit the head with the declared length bumped to cover `trailing`.
fn forged_body(head: &[u8], payload: &[u8], trailing: &[u8]) -> Vec<u8> {
    let mut out = head.to_vec();
    write_uvarint((payload.len() + trailing.len()) as u64, &mut out);
    out.extend_from_slice(payload);
    out.extend_from_slice(trailing);
    out
}

fn assert_trailing_rejected(head: &[u8], payload: &[u8], tag: u16, what: &str) {
    let forged = forged_body(head, payload, &[0xAA]);
    let err = match v1::decode(&forged) {
        Ok(_) => panic!("{what}: trailing byte inside the declared payload decoded as Ok"),
        Err(err) => err,
    };
    assert!(
        matches!(err, ShareError::MalformedExtension { tag: t, .. } if t == tag),
        "{what}: trailing byte is a malformed extension, got: {err}"
    );
}

fn aux_model() -> (CreasePatternModel, CreasePatternModel) {
    let without = base_model();
    let mut with = base_model();
    with.aux_line_segments.push(LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(0.0, 100.0),
        LineColor::Blue2,
    ));
    (with, without)
}

#[test]
fn aux_payload_trailing_is_rejected() {
    let (with, without) = aux_model();
    let (head, payload) = single_extension_parts(with, &without, None, None, 0x0003);
    assert_trailing_rejected(&head, &payload, 0x0003, "aux");
}

#[test]
fn honest_aux_still_decodes() {
    let (with, _) = aux_model();
    let body = v1::encode(&with, None, 36, 36).expect("encode");
    let back = v1::decode(&body).expect("honest aux decodes").model;
    assert_eq!(back.aux_line_segments.len(), 1);
    assert_eq!(back.line_segments.len(), 1);
}

fn custom_model() -> (CreasePatternModel, CreasePatternModel) {
    let without = base_model();
    let mut with = CreasePatternModel::default();
    let mut coloured = segment(0.0, 0.0, 100.0, 0.0);
    coloured.customized = 1;
    coloured.customized_color = RgbColor::new(10, 20, 30);
    with.line_segments.push(coloured);
    (with, without)
}

#[test]
fn custom_colour_payload_trailing_is_rejected() {
    let (with, without) = custom_model();
    let (head, payload) = single_extension_parts(with, &without, None, None, 0x8002);
    assert_trailing_rejected(&head, &payload, 0x8002, "custom colour");
}

#[test]
fn honest_custom_colour_still_decodes() {
    let (with, _) = custom_model();
    let body = v1::encode(&with, None, 36, 36).expect("encode");
    let back = v1::decode(&body)
        .expect("honest custom colour decodes")
        .model;
    assert_eq!(back.line_segments.len(), 1);
    assert_eq!(back.line_segments[0].customized, 1);
    assert_eq!(
        back.line_segments[0].customized_color,
        RgbColor::new(10, 20, 30)
    );
}

/// One magnitude among many creases: the sparse path (mode varint 0 leads
/// the payload).
fn sparse_magnitude_model() -> (CreasePatternModel, CreasePatternModel) {
    let mut with = CreasePatternModel::default();
    for i in 0..64 {
        with.line_segments
            .push(segment(0.0, f64::from(i), 100.0, f64::from(i) + 0.5));
    }
    with.line_segments[0].fold_magnitude = FoldMagnitude::from_degrees(90.0);
    let mut without = with.clone();
    for s in &mut without.line_segments {
        s.fold_magnitude = None;
    }
    (with, without)
}

/// Every crease carrying a magnitude from a two-value alphabet: the dense
/// path (mode varint 1 leads the payload).
fn dense_magnitude_model() -> (CreasePatternModel, CreasePatternModel) {
    let mut with = CreasePatternModel::default();
    for i in 0..6 {
        let mut s = segment(0.0, f64::from(i) * 10.0, 100.0, f64::from(i) * 10.0);
        let degrees = if i % 2 == 0 { 90.0 } else { 60.0 };
        s.fold_magnitude = FoldMagnitude::from_degrees(degrees);
        with.line_segments.push(s);
    }
    let mut without = with.clone();
    for s in &mut without.line_segments {
        s.fold_magnitude = None;
    }
    (with, without)
}

#[test]
fn sparse_fold_magnitude_payload_trailing_is_rejected() {
    let (with, without) = sparse_magnitude_model();
    let (head, payload) = single_extension_parts(with, &without, None, None, 0x8001);
    assert_eq!(
        payload[0], 0,
        "fixture must exercise the sparse magnitude path"
    );
    assert_trailing_rejected(&head, &payload, 0x8001, "sparse fold magnitude");
}

#[test]
fn dense_fold_magnitude_payload_trailing_is_rejected() {
    let (with, without) = dense_magnitude_model();
    let (head, payload) = single_extension_parts(with, &without, None, None, 0x8001);
    assert_eq!(
        payload[0], 1,
        "fixture must exercise the dense magnitude path"
    );
    assert_trailing_rejected(&head, &payload, 0x8001, "dense fold magnitude");
}

#[test]
fn honest_fold_magnitudes_still_decode() {
    let (sparse, _) = sparse_magnitude_model();
    let body = v1::encode(&sparse, None, 36, 36).expect("encode");
    let back = v1::decode(&body)
        .expect("honest sparse magnitudes decode")
        .model;
    let carrying = back
        .line_segments
        .iter()
        .filter(|s| s.fold_magnitude.is_some())
        .count();
    assert_eq!(carrying, 1, "the single sparse magnitude survived");

    let (dense, _) = dense_magnitude_model();
    let body = v1::encode(&dense, None, 36, 36).expect("encode");
    let back = v1::decode(&body)
        .expect("honest dense magnitudes decode")
        .model;
    let mut degrees: Vec<f64> = back
        .line_segments
        .iter()
        .map(|s| {
            s.fold_magnitude
                .expect("every crease has a magnitude")
                .degrees()
        })
        .collect();
    degrees.sort_by(f64::total_cmp);
    assert_eq!(degrees, vec![60.0, 60.0, 60.0, 90.0, 90.0, 90.0]);
}

#[test]
fn title_payload_has_no_trailing_concept() {
    // The payload IS the title: there is no inner cursor to leave bytes in.
    // Extra bytes extend the title (or fail UTF-8); none are ever ignored.
    let baseline = base_model();
    let (head, payload) =
        single_extension_parts(baseline.clone(), &baseline, Some("hello"), None, 0x0001);
    assert_eq!(payload, b"hello");
    let extended = forged_body(&head, &payload, b"!");
    let decoded = v1::decode(&extended).expect("longer title still decodes");
    assert_eq!(decoded.title.as_deref(), Some("hello!"));

    let bad_utf8 = forged_body(&head, &payload, &[0xFF]);
    let err = match v1::decode(&bad_utf8) {
        Ok(_) => panic!("invalid UTF-8 title bytes must not decode as Ok"),
        Err(err) => err,
    };
    assert!(
        matches!(err, ShareError::BadUtf8 { tag: 0x0001 }),
        "non-UTF8 title bytes are rejected, got: {err}"
    );
}

#[test]
fn unknown_ancillary_tag_still_skips() {
    // Control: canonicality enforcement must not break forward compatibility.
    // Retag the honest single-extension aux body with an unknown ancillary
    // tag (0x0009 < 0x8000, same one-byte varint width, framing untouched).
    let (with, without) = aux_model();
    let body = v1::encode(&with, None, 36, 36).expect("encode");
    let baseline = v1::encode(&without, None, 36, 36).expect("encode");
    let tag_pos = baseline.len(); // [prefix][n_ext=1][tag] — tag follows the count
    assert_eq!(body[tag_pos - 1], 1, "honest body carries one extension");
    assert_eq!(body[tag_pos], 0x03, "that extension is TAG_AUX");
    let mut retagged = body.clone();
    retagged[tag_pos] = 0x09;
    let decoded = v1::decode(&retagged).expect("unknown ancillary tag skips");
    assert_eq!(decoded.skipped_extensions, 1);
    assert!(
        decoded.model.aux_line_segments.is_empty(),
        "skipped payload applies nothing"
    );
}
