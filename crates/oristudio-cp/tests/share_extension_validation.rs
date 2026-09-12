//! Extension payloads must be exactly consumed; circles need valid radii.
//!
//! The inline extension arms never checked that their inner cursor was fully
//! consumed, so trailing bytes inside an extension payload decoded as `Ok`
//! and ignored; and `TAG_CIRCLES` pushed `Circle::new` with whatever signed
//! radius the wire carried, admitting geometrically invalid negative radii
//! into the model. (The grid arm's payload is pinned down by the grid
//! validation branch; aux/custom-colour/magnitude payloads keep their
//! current shape — see the branch notes.)

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{Circle, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
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
/// count in place.
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

#[test]
fn negative_circle_radius_is_rejected() {
    // n=1, x=0, y=0, r: svarint -1 (zigzag 1), colour code 2 (Black0).
    // Any wire unit decodes to a negative radius regardless of the quantum.
    let err = decode_share(&with_extension(0x0004, &[0x01, 0x00, 0x00, 0x01, 0x02]))
        .expect_err("negative radius must be rejected");
    assert!(
        matches!(err, ShareError::MalformedExtension { tag: 0x0004, .. }),
        "negative radius is a malformed extension, got: {err}"
    );
}

#[test]
fn circle_payload_trailing_is_rejected() {
    // Same single circle with r=+5 wire units, plus one trailing byte inside
    // the extension payload.
    let err = decode_share(&with_extension(
        0x0004,
        &[0x01, 0x00, 0x00, 0x0A, 0x02, 0xAA],
    ))
    .expect_err("circle trailing must be rejected");
    assert!(
        matches!(err, ShareError::MalformedExtension { tag: 0x0004, .. }),
        "circle trailing is a malformed extension, got: {err}"
    );
}

#[test]
fn text_payload_trailing_is_rejected() {
    // n=1, x=0, y=0, len=1, 'A', plus one trailing byte.
    let err = decode_share(&with_extension(
        0x0005,
        &[0x01, 0x00, 0x00, 0x01, b'A', 0xAA],
    ))
    .expect_err("text trailing must be rejected");
    assert!(
        matches!(err, ShareError::MalformedExtension { tag: 0x0005, .. }),
        "text trailing is a malformed extension, got: {err}"
    );
}

#[test]
fn honest_circles_still_roundtrip() {
    let mut model = CreasePatternModel::default();
    model.line_segments.push(LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        LineColor::Red1,
    ));
    model
        .circles
        .push(Circle::new(10.0, 20.0, 30.0, LineColor::Green6));
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
    assert_eq!(back.circles.len(), 1);
    assert!(
        back.circles[0].r > 0.0,
        "radius survived: {}",
        back.circles[0].r
    );
    assert!(
        (back.circles[0].r - 30.0).abs() < 1e-6,
        "radius value survived"
    );
}
