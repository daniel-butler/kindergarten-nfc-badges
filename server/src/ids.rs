//! Badge ID normalization and matching.
//!
//! The phone reads the full 7-byte NTAG215 UID. The USB keyboard-wedge reader may
//! emit the same UID byte-reversed and/or truncated to 4 bytes (first or last).
//! Everything here works on canonical IDs: uppercase hex, no separators, even length.

/// How an incoming ID matched a known ID. Lower is a stronger match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MatchKind {
    Exact,
    Reversed,
    Truncated,
}

const TRUNCATED_HEX_LEN: usize = 8;
const MAX_HEX_LEN: usize = 40;

/// Canonicalize a raw ID: strip whitespace/separators and an optional `0x`,
/// uppercase, left-pad odd lengths with `0`. Returns `None` if it isn't hex.
pub fn normalize(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let trimmed = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    let mut hex: String = trimmed
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, ':' | '-' | '_' | '.'))
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if hex.is_empty() || hex.len() > MAX_HEX_LEN || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    if hex.len() % 2 == 1 {
        hex.insert(0, '0');
    }
    Some(hex)
}

/// Reverse byte order of a canonical hex ID ("04A1B2" -> "B2A104").
pub fn reverse_bytes(hex: &str) -> String {
    hex.as_bytes()
        .chunks(2)
        .rev()
        .map(|pair| std::str::from_utf8(pair).unwrap())
        .collect()
}

/// Compare two canonical IDs, either of which may be the reader's or the phone's form.
pub fn match_kind(known: &str, incoming: &str) -> Option<MatchKind> {
    if known == incoming {
        return Some(MatchKind::Exact);
    }
    if known.len() == incoming.len() && reverse_bytes(known) == incoming {
        return Some(MatchKind::Reversed);
    }
    let (short, long) = if known.len() < incoming.len() {
        (known, incoming)
    } else {
        (incoming, known)
    };
    if short.len() != TRUNCATED_HEX_LEN || long.len() <= TRUNCATED_HEX_LEN {
        return None;
    }
    // Reversing both sides maps each candidate onto another, so checking the
    // short ID and its reverse against prefix/suffix of the long ID covers
    // all four (prefix|suffix) x (normal|reversed) cases.
    let prefix = &long[..TRUNCATED_HEX_LEN];
    let suffix = &long[long.len() - TRUNCATED_HEX_LEN..];
    let short_rev = reverse_bytes(short);
    [short, short_rev.as_str()]
        .iter()
        .any(|s| *s == prefix || *s == suffix)
        .then_some(MatchKind::Truncated)
}

/// Find which entry an incoming ID belongs to. Each entry is a list of known IDs
/// (a card's canonical ID plus aliases). The strongest match wins; if the best
/// match is shared by two different entries, the result is ambiguous and `None`.
pub fn resolve<'a, I, J>(entries: I, incoming: &str) -> Option<(usize, MatchKind)>
where
    I: IntoIterator<Item = J>,
    J: IntoIterator<Item = &'a str>,
{
    let mut best: Option<(usize, MatchKind)> = None;
    let mut ambiguous = false;
    for (idx, ids) in entries.into_iter().enumerate() {
        let Some(kind) = ids
            .into_iter()
            .filter_map(|id| match_kind(id, incoming))
            .min()
        else {
            continue;
        };
        match best {
            Some((_, best_kind)) if kind > best_kind => {}
            Some((_, best_kind)) if kind == best_kind => ambiguous = true,
            _ => {
                best = Some((idx, kind));
                ambiguous = false;
            }
        }
    }
    if ambiguous { None } else { best }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: &str = "04A1B2C3D4E5F6";
    const FULL_REV: &str = "F6E5D4C3B2A104";

    #[test]
    fn normalize_strips_separators_and_uppercases() {
        assert_eq!(normalize("04:a1:b2:c3:d4:e5:f6").as_deref(), Some(FULL));
        assert_eq!(normalize(" 04-A1-B2-C3-D4-E5-F6\n").as_deref(), Some(FULL));
        assert_eq!(normalize("0x04a1b2c3d4e5f6").as_deref(), Some(FULL));
        assert_eq!(normalize("04 a1 b2 c3 d4 e5 f6").as_deref(), Some(FULL));
    }

    #[test]
    fn normalize_pads_odd_length() {
        assert_eq!(normalize("ABC").as_deref(), Some("0ABC"));
    }

    #[test]
    fn normalize_rejects_garbage() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("   "), None);
        assert_eq!(normalize("hello"), None);
        assert_eq!(normalize(&"A".repeat(41)), None);
    }

    #[test]
    fn reverse_bytes_reverses_pairs_not_chars() {
        assert_eq!(reverse_bytes(FULL), FULL_REV);
        assert_eq!(reverse_bytes("0A0B"), "0B0A");
        assert_eq!(reverse_bytes(""), "");
    }

    #[test]
    fn exact_and_reversed() {
        assert_eq!(match_kind(FULL, FULL), Some(MatchKind::Exact));
        assert_eq!(match_kind(FULL, FULL_REV), Some(MatchKind::Reversed));
        assert_eq!(match_kind(FULL_REV, FULL), Some(MatchKind::Reversed));
    }

    #[test]
    fn truncated_all_four_variants_both_directions() {
        // first 4, last 4, first 4 of reversed, last 4 of reversed
        for short in ["04A1B2C3", "C3D4E5F6", "F6E5D4C3", "C3B2A104"] {
            assert_eq!(
                match_kind(FULL, short),
                Some(MatchKind::Truncated),
                "{short} vs full"
            );
            assert_eq!(
                match_kind(short, FULL),
                Some(MatchKind::Truncated),
                "full vs {short}"
            );
            assert_eq!(
                match_kind(FULL_REV, short),
                Some(MatchKind::Truncated),
                "{short} vs reversed full"
            );
        }
    }

    #[test]
    fn truncated_rejects_middle_bytes_and_wrong_lengths() {
        assert_eq!(match_kind(FULL, "A1B2C3D4"), None);
        assert_eq!(match_kind(FULL, "04A1B2"), None);
        assert_eq!(match_kind(FULL, "04A1B2C3D4"), None);
        assert_eq!(match_kind(FULL, "04A1B2C4"), None);
    }

    #[test]
    fn two_short_ids_only_match_exact_or_reversed() {
        assert_eq!(match_kind("04A1B2C3", "04A1B2C3"), Some(MatchKind::Exact));
        assert_eq!(
            match_kind("04A1B2C3", "C3B2A104"),
            Some(MatchKind::Reversed)
        );
        assert_eq!(match_kind("04A1B2C3", "B2C3D4E5"), None);
    }

    fn entries(cards: &[&[&'static str]]) -> Vec<Vec<&'static str>> {
        cards.iter().map(|c| c.to_vec()).collect()
    }

    #[test]
    fn resolve_finds_card_via_alias() {
        let cards = entries(&[&["04111111111111"], &["04222222222222", "ABCDEF01"]]);
        assert_eq!(
            resolve(cards.clone(), "ABCDEF01"),
            Some((1, MatchKind::Exact))
        );
        assert_eq!(resolve(cards, "01EFCDAB"), Some((1, MatchKind::Reversed)));
    }

    #[test]
    fn resolve_prefers_stronger_match() {
        // Card 0's full UID truncates to card 1's exact short alias.
        let cards = entries(&[&["04A1B2C3D4E5F6"], &["04A1B2C3"]]);
        assert_eq!(resolve(cards, "04A1B2C3"), Some((1, MatchKind::Exact)));
    }

    #[test]
    fn resolve_ambiguous_truncation_is_none() {
        let cards = entries(&[&["04A1B2C3111111"], &["04A1B2C3222222"]]);
        assert_eq!(resolve(cards, "04A1B2C3"), None);
    }

    #[test]
    fn resolve_unknown_is_none() {
        let cards = entries(&[&["04A1B2C3D4E5F6"]]);
        assert_eq!(resolve(cards, "DEADBEEF"), None);
        assert_eq!(resolve(Vec::<Vec<&str>>::new(), "DEADBEEF"), None);
    }
}
