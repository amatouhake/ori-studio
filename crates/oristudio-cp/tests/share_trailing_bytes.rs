//! Trailing bytes must be rejected, not silently ignored.
//!
//! The `Stored` frame path already rejects trailing bytes (`LengthMismatch`),
//! but `DeflateRaw` stopped at the end of the deflate stream and accepted
//! anything after it; likewise the v1 body decoder never checked that the
//! extension section consumed the whole body, so an appended TLV with an
//! unbumped count decoded as `Ok { skipped: 0 }`. Either gives two different
//! byte strings the same document: a hidden-data channel in a URL fragment.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{ShareError, ShareOptions, decode_share, encode_share};

fn seg(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn doc(model: CreasePatternModel) -> CreasePatternDocument {
    CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    }
}

/// A document large enough that DEFLATE wins over storing verbatim.
fn big_document() -> CreasePatternDocument {
    let mut model = CreasePatternModel::default();
    for k in 0..128 {
        let t = f64::from(k);
        model.line_segments.push(seg(
            t,
            t + 1.0,
            t + 50.0,
            t - 50.0,
            if k % 2 == 0 {
                LineColor::Red1
            } else {
                LineColor::Blue2
            },
        ));
    }
    doc(model)
}

fn single_segment_document() -> CreasePatternDocument {
    let mut model = CreasePatternModel::default();
    model
        .line_segments
        .push(seg(0.0, 0.0, 100.0, 0.0, LineColor::Red1));
    doc(model)
}

fn write_uvarint(out: &mut Vec<u8>, mut v: u64) {
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

/// Build a valid `Stored` frame around an arbitrary body.
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

#[test]
fn deflate_frame_with_trailing_bytes_is_rejected() {
    let payload = encode_share(&big_document(), ShareOptions::default()).expect("encode");
    assert_eq!(
        payload[5], 1,
        "fixture must exercise the DeflateRaw path (compressor byte)"
    );
    assert!(decode_share(&payload).is_ok(), "honest payload decodes");

    let mut forged = payload;
    forged.extend_from_slice(&[0u8; 16]);
    let err = decode_share(&forged).expect_err("trailing bytes must be rejected");
    assert!(
        matches!(err, ShareError::LengthMismatch { .. }),
        "same framing error Stored reports, got: {err}"
    );
}

#[test]
fn stored_frame_with_trailing_bytes_is_rejected() {
    // Reframe through an explicit `Stored` frame: `encode_share` may itself
    // choose DeflateRaw for small bodies, which would exercise the other path.
    let payload =
        encode_share(&single_segment_document(), ShareOptions::default()).expect("encode");
    let (_, body) = oristudio_cp::share::frame::read(&payload, &[1]).expect("read");
    let mut forged = framed(&body);
    forged.extend_from_slice(&[0u8; 16]);
    let err = decode_share(&forged).expect_err("trailing must be rejected");
    assert!(
        matches!(err, ShareError::LengthMismatch { .. }),
        "stored trailing is a framing error, got: {err}"
    );
}

#[test]
fn body_with_uncounted_extension_tlv_is_rejected() {
    let payload =
        encode_share(&single_segment_document(), ShareOptions::default()).expect("encode");
    let (_, mut body) = oristudio_cp::share::frame::read(&payload, &[1]).expect("read");
    // Sanity: this document carries no extensions, so the body ends with the
    // zero extension count.
    assert_eq!(*body.last().expect("non-empty body"), 0);
    // Append an unknown *ancillary* TLV without bumping the count: a decoder
    // that stops after `n_ext` extensions never sees it.
    let mut tlv = Vec::new();
    write_uvarint(&mut tlv, 0x0006);
    write_uvarint(&mut tlv, 3);
    tlv.extend_from_slice(&[7, 8, 9]);
    body.extend_from_slice(&tlv);

    let err = decode_share(&framed(&body)).expect_err("uncounted TLV must be rejected");
    assert!(
        matches!(err, ShareError::MalformedExtension { .. }),
        "trailing body bytes are malformed, got: {err}"
    );
}

#[test]
fn raw_body_with_trailing_bytes_is_rejected() {
    let document = single_segment_document();
    let fold = oristudio_cp::io::fold::export_fold_file_document_json(&document).expect("export");
    let mut body = oristudio_cp::share::v1::encode_raw(&fold);
    assert!(
        oristudio_cp::share::v1::decode(&body).is_ok(),
        "honest raw body decodes"
    );
    body.extend_from_slice(&[0x01, 0x02, 0x03]);
    assert!(
        oristudio_cp::share::v1::decode(&body).is_err(),
        "trailing bytes after a raw body must be rejected"
    );
}
