//! The encoder's decode-and-compare self-check.
//!
//! This is the safety mechanism, not a debug aid. Every payload is decoded by
//! the *shipped decoder* and compared against the source before it is emitted;
//! a mismatch raises the quantum and retries, and a persistent mismatch falls
//! back to a lossless `.fold` body. That converts an entire class of
//! silent-wrongness bug into, at worst, a larger link.

use crate::geometry::FoldDirection;
use std::collections::BTreeMap;

use crate::CreasePatternDocument;
use crate::checks_spatial::dispatched_camv;
use crate::geometry::{Circle, LineSegment};
use crate::model::CreasePatternModel;

/// Vertex-identity tolerance for matching one document's diagnostics against the
/// other's. Far tighter than Oriedita's own 1e-6 clustering radius, and far
/// looser than any displacement the codec can introduce.
const MATCH_TOLERANCE: f64 = 1e-4;

/// Structural equality: same creases, same colours, same fold magnitudes.
///
/// Compared as a multiset keyed on exact reconstructed coordinates, because the
/// decoder is supposed to reproduce the encoder's intent *bit-identically* —
/// this is not a tolerance check and must not become one.
pub fn creases_match(source: &[LineSegment], decoded: &[LineSegment]) -> bool {
    if source.len() != decoded.len() {
        return false;
    }
    let key = |s: &LineSegment| {
        let (a, b) = if (s.a.x, s.a.y) <= (s.b.x, s.b.y) {
            (s.a, s.b)
        } else {
            (s.b, s.a)
        };
        // Every field the codec carries participates: a regression that drops
        // the hint or custom-colour extensions must fail the self-check, not
        // match a stripped decoding. (Session state — `active`, `selected` —
        // is deliberately not carried and stays out of the key.)
        (
            a.x.to_bits(),
            a.y.to_bits(),
            b.x.to_bits(),
            b.y.to_bits(),
            s.color.number(),
            crate::geometry::FoldMagnitude::to_transport(s.fold_magnitude),
            match s.fold_direction_hint {
                None => 0u8,
                Some(FoldDirection::Mountain) => 1,
                Some(FoldDirection::Valley) => 2,
            },
            // Transported custom-colour semantics, not stored state: the codec
            // carries an RGB only for an enabled (`customized != 0`) crease and
            // nothing at all otherwise, so an inactive retained RGB — or any
            // nonzero `customized` spelling — canonicalizes rather than compares.
            // Comparing the stored field fails the self-check on a document the
            // codec reproduces exactly, forcing a needless RAW fallback.
            s.customized != 0,
            if s.customized != 0 {
                (
                    s.customized_color.red,
                    s.customized_color.green,
                    s.customized_color.blue,
                )
            } else {
                (0, 0, 0)
            },
        )
    };
    let mut counts: BTreeMap<_, i64> = BTreeMap::new();
    for s in source {
        *counts.entry(key(s)).or_insert(0) += 1;
    }
    for s in decoded {
        *counts.entry(key(s)).or_insert(0) -= 1;
    }
    counts.values().all(|&c| c == 0)
}

/// Diagnostic-set equality, in **both** directions: no violation created and
/// none removed.
///
/// The second direction matters as much as the first. Snapping coordinates can
/// accidentally "repair" a vertex, and a transport that quietly fixes the user's
/// pattern has changed their document just as surely as one that breaks it.
pub fn diagnostics_match(source: &CreasePatternModel, decoded: &CreasePatternModel) -> bool {
    let a = dispatched_camv(source);
    let b = dispatched_camv(decoded);

    if a.flat.len() != b.flat.len() || a.spatial.len() != b.spatial.len() {
        return false;
    }

    let mut used = vec![false; b.flat.len()];
    for va in &a.flat {
        let hit = b.flat.iter().enumerate().position(|(i, vb)| {
            !used[i]
                && vb.rule == va.rule
                && vb.color == va.color
                && (vb.point.x - va.point.x).abs() < MATCH_TOLERANCE
                && (vb.point.y - va.point.y).abs() < MATCH_TOLERANCE
        });
        match hit {
            Some(i) => used[i] = true,
            None => return false,
        }
    }

    // Spatial vertices carry a continuous residual rather than a verdict, so the
    // meaningful test is that no vertex crosses the closure bar in either
    // direction.
    let bar = 1e-6f64.to_radians();
    let mut used = vec![false; b.spatial.len()];
    for ra in &a.spatial {
        let hit = b.spatial.iter().enumerate().position(|(i, rb)| {
            !used[i]
                && (rb.point.x - ra.point.x).abs() < MATCH_TOLERANCE
                && (rb.point.y - ra.point.y).abs() < MATCH_TOLERANCE
        });
        let Some(i) = hit else { return false };
        used[i] = true;
        match (ra.residual, b.spatial[i].residual) {
            (Some(x), Some(y)) => {
                if (x < bar) != (y < bar) {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
    }
    true
}

/// RAW-fallback semantic check: decode success alone does not mean the document
/// survived.
///
/// A RAW body is the document's own FOLD text, decoded by the *ordinary FOLD
/// importer*. That importer is a normalizing ecosystem contract, not an exact
/// transport: it similarity-transforms crease geometry onto the standard paper
/// box, returns no title, and keeps only the fields FOLD itself carries (no
/// aux segments, no standalone points, hints only beside unassigned creases,
/// custom colours only for `customized == 1`, grid size and style only). The
/// fallback path therefore compares on *transported semantics* and reports the
/// first diverged field as a static reason; the caller turns that into a typed
/// error rather than emitting a silently-changed link.
///
/// Geometry compares against the FOLD-normalized source — the recipient sees
/// exactly what opening the same bytes as a `.fold` file shows, so the
/// normalization itself is the contract, not a divergence. Diagnostics are not
/// re-compared: they are a function of bit-identical geometry, and the compact
/// path already owns that comparison. Session state (`active`, `selected`,
/// `operation_frame`, `metadata`) is deliberately not carried and stays out.
pub fn raw_fallback_preserves(
    source: &CreasePatternDocument,
    decoded: &CreasePatternModel,
) -> Result<(), &'static str> {
    // The shipped RAW grammar decodes the title as `None`, while the body it
    // wraps still carries the frame title — emitting here would silently drop
    // the user's title. Mirror the compact codec's empty-means-absent rule.
    if source.title.as_deref().filter(|t| !t.is_empty()).is_some() {
        return Err("fallback dropped the title");
    }

    let mut normalized = source.crease_pattern.clone();
    // A degenerate source (empty, point-like) cannot survive FOLD normalization;
    // failing here keeps the typed rejection instead of comparing unnormalized
    // content and risking a silently-changed link.
    crate::io::fold::normalize_like_fold_import(&mut normalized)
        .map_err(|_| "fallback cannot normalize degenerate geometry")?;

    // The encode entry gates finite source coordinates, so non-finite geometry
    // on either side means the FOLD round trip itself broke down — notably a
    // degenerate import bounds (every vertex on one horizontal line) scales by
    // infinity. Bit-compare alone would bless `inf == inf`.
    for s in normalized
        .line_segments
        .iter()
        .chain(decoded.line_segments.iter())
    {
        if !s.a.x.is_finite() || !s.a.y.is_finite() || !s.b.x.is_finite() || !s.b.y.is_finite() {
            return Err("fallback produced non-finite geometry");
        }
    }

    if !transported_segments_match(&normalized.line_segments, &decoded.line_segments) {
        return Err("fallback changed crease geometry, colours, hints, customs or magnitudes");
    }
    // FOLD has no aux section and no standalone points: equality holds exactly
    // when the source carries none.
    if !transported_segments_match(&normalized.aux_line_segments, &decoded.aux_line_segments) {
        return Err("fallback dropped aux segments");
    }
    if point_multiset(&normalized.points) != point_multiset(&decoded.points) {
        return Err("fallback dropped standalone points");
    }
    if decoded.grid != normalized.grid {
        return Err("fallback changed the grid");
    }
    if decoded.texts != normalized.texts {
        return Err("fallback changed texts");
    }
    if !transported_circles_match(&normalized.circles, &decoded.circles) {
        return Err("fallback changed circles");
    }
    Ok(())
}

/// Transported per-crease semantics: everything FOLD carries for an edge.
///
/// Inactive custom-colour RGB canonicalizes to zero — neither FOLD nor the
/// compact grammar transports it, so comparing the stored field would fail a
/// document the fallback reproduces exactly (the C1 trap). `customized` itself
/// compares as presence: FOLD only round-trips the `== 1` spelling.
fn transported_segment_key(
    s: &LineSegment,
) -> (u64, u64, u64, u64, i32, u32, u8, bool, (u8, u8, u8)) {
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
        crate::geometry::FoldMagnitude::to_transport(s.fold_magnitude),
        match s.fold_direction_hint {
            None => 0u8,
            Some(FoldDirection::Mountain) => 1,
            Some(FoldDirection::Valley) => 2,
        },
        s.customized != 0,
        if s.customized != 0 {
            (
                s.customized_color.red,
                s.customized_color.green,
                s.customized_color.blue,
            )
        } else {
            (0, 0, 0)
        },
    )
}

fn transported_segments_match(source: &[LineSegment], decoded: &[LineSegment]) -> bool {
    if source.len() != decoded.len() {
        return false;
    }
    let mut counts: BTreeMap<_, i64> = BTreeMap::new();
    for s in source {
        *counts.entry(transported_segment_key(s)).or_insert(0) += 1;
    }
    for s in decoded {
        *counts.entry(transported_segment_key(s)).or_insert(0) -= 1;
    }
    counts.values().all(|&c| c == 0)
}

fn point_multiset(points: &[crate::geometry::Point]) -> BTreeMap<(u64, u64), i64> {
    let mut counts = BTreeMap::new();
    for p in points {
        *counts.entry((p.x.to_bits(), p.y.to_bits())).or_insert(0) += 1;
    }
    counts
}

/// Transported per-circle semantics, with the same inactive-RGB
/// canonicalization as creases: FOLD keeps a custom colour only for
/// `customized == 1`.
fn transported_circles_match(source: &[Circle], decoded: &[Circle]) -> bool {
    if source.len() != decoded.len() {
        return false;
    }
    let key = |c: &Circle| {
        (
            c.x.to_bits(),
            c.y.to_bits(),
            c.r.to_bits(),
            c.color.number(),
            c.customized != 0,
            if c.customized != 0 {
                (
                    c.customized_color.red,
                    c.customized_color.green,
                    c.customized_color.blue,
                )
            } else {
                (0, 0, 0)
            },
        )
    };
    let mut counts: BTreeMap<_, i64> = BTreeMap::new();
    for c in source {
        *counts.entry(key(c)).or_insert(0) += 1;
    }
    for c in decoded {
        *counts.entry(key(c)).or_insert(0) -= 1;
    }
    counts.values().all(|&c| c == 0)
}
