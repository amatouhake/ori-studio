//! TAG_GRID must validate its varints.
//!
//! The decoder cast the grid-size uvarint straight to `i32` (`u64::MAX`
//! became `-1`, `2^31` became `i32::MIN`) and mapped an unknown grid state
//! through `unwrap_or_default`, so a hostile link set nonsense grid
//! metadata while loading clean (`skipped == 0`). The honest encoder clamps
//! both values with `.max(0)` and only ever writes states 0-2, so rejecting
//! anything outside `0..=i32::MAX` / known states never fires honestly.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::{CreasePatternModel, GridState};
use oristudio_cp::share::{ShareError, ShareOptions, decode_share, encode_share};

fn uvarint(mut v: u64, out: &mut Vec<u8>) {
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

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn framed(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"OCS1");
    out.push(1);
    out.push(0); // Stored
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&crc32(body).to_le_bytes());
    out.extend_from_slice(body);
    out
}

/// Take a real extensionless payload and append one extension, bumping the
/// count in place (mirrors `share_frame::with_extension`).
fn with_extension(tag: u16, payload: &[u8]) -> Vec<u8> {
    let mut model = CreasePatternModel::default();
    model.line_segments.push(LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        LineColor::Red1,
    ));
    let framed_payload = encode_share(
        &CreasePatternDocument {
            crease_pattern: model,
            ..Default::default()
        },
        ShareOptions::default(),
    )
    .expect("encode");
    let (_, mut body) = oristudio_cp::share::frame::read(&framed_payload, &[1]).expect("read");
    let count_pos = body.len().checked_sub(1).expect("body has a count");
    assert_eq!(body[count_pos], 0, "sample document has no extensions");
    body[count_pos] = 1;
    uvarint(u64::from(tag), &mut body);
    uvarint(payload.len() as u64, &mut body);
    body.extend_from_slice(payload);
    framed(&body)
}

fn grid_payload(size: u64, state: u64, trailing: &[u8]) -> Vec<u8> {
    let mut payload = Vec::new();
    uvarint(size, &mut payload);
    uvarint(state, &mut payload);
    payload.extend_from_slice(trailing);
    payload
}

fn assert_grid_rejected(payload: Vec<u8>, case: &str) {
    let err = decode_share(&with_extension(0x0002, &payload))
        .expect_err(&format!("grid {case} must be rejected"));
    assert!(
        matches!(err, ShareError::MalformedExtension { tag: 0x0002, .. }),
        "grid {case} is a malformed extension, got: {err}"
    );
}

#[test]
fn grid_size_beyond_i32_is_rejected() {
    assert_grid_rejected(grid_payload(u64::MAX, 1, &[]), "size=u64::MAX");
    assert_grid_rejected(grid_payload(1u64 << 31, 1, &[]), "size=2^31");
    assert_grid_rejected(grid_payload(i32::MAX as u64 + 1, 1, &[]), "size=i32::MAX+1");
}

#[test]
fn unknown_grid_state_is_rejected() {
    assert_grid_rejected(grid_payload(8, 9999, &[]), "state=9999");
}

#[test]
fn grid_payload_trailing_is_rejected() {
    assert_grid_rejected(grid_payload(8, 1, &[0xAA]), "trailing byte");
}

#[test]
fn honest_grid_values_still_roundtrip() {
    // Boundary: i32::MAX is representable and must keep decoding.
    for (size, state) in [
        (8, GridState::Hidden),
        (16, GridState::Full),
        (i32::MAX, GridState::WithinPaper),
    ] {
        let mut model = CreasePatternModel::default();
        model.line_segments.push(LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            LineColor::Red1,
        ));
        model.grid.grid_size = size;
        model.grid.base_state = state;
        let payload = encode_share(
            &CreasePatternDocument {
                crease_pattern: model,
                ..Default::default()
            },
            ShareOptions::default(),
        )
        .expect("encode");
        let back = decode_share(&payload)
            .expect("decode")
            .document
            .crease_pattern;
        assert_eq!(back.grid.grid_size, size);
        assert_eq!(back.grid.base_state, state);
    }
}
