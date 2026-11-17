use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::registry::{Card, Registry};

pub const LINK_WINDOW: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Phone,
    Reader,
}

#[derive(Debug, Clone, Serialize)]
pub struct TapEvent {
    pub raw_id: String,
    pub canonical_id: String,
    pub source: Source,
    pub card: Option<Card>,
    pub ts: u64,
    /// True when this tap just attached a new alias to `card`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub linked: bool,
}

struct RecentKnownTap {
    card_id: String,
    source: Source,
    at: Instant,
}

/// Link mode: an unknown ID tapped within `LINK_WINDOW` of a known card tapped
/// on the *other* source becomes an alias of that card.
#[derive(Default)]
pub struct Linker {
    enabled: bool,
    recent: Option<RecentKnownTap>,
}

impl Linker {
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.recent = None;
    }

    /// Resolve a canonical ID, linking it if link mode allows. Returns the card and
    /// whether a link was made.
    pub fn handle(
        &mut self,
        registry: &mut Registry,
        canonical_id: &str,
        source: Source,
        now: Instant,
    ) -> (Option<Card>, bool) {
        let mut card = registry.resolve(canonical_id).cloned();
        let mut linked = false;
        if !self.enabled {
            return (card, linked);
        }
        if card.is_none()
            && let Some(recent) = &self.recent
            && recent.source != source
            && now.duration_since(recent.at) <= LINK_WINDOW
        {
            match registry.add_alias(&recent.card_id, canonical_id) {
                Ok(c) => {
                    card = Some(c);
                    linked = true;
                }
                Err(e) => eprintln!("link failed: {e}"),
            }
        }
        self.recent = card.as_ref().map(|c| RecentKnownTap {
            card_id: c.canonical_id.clone(),
            source,
            at: now,
        });
        (card, linked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(name: &str) -> Registry {
        let dir = std::env::temp_dir().join(format!("badge-taps-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.json");
        let _ = std::fs::remove_file(&path);
        let mut reg = Registry::load(path).unwrap();
        reg.replace(vec![Card {
            canonical_id: "04A1B2C3D4E5F6".into(),
            aliases: vec![],
            emoji: "🐧".into(),
            label: "Penguin".into(),
            color: None,
        }])
        .unwrap();
        reg
    }

    fn linker() -> Linker {
        let mut l = Linker::default();
        l.set_enabled(true);
        l
    }

    #[test]
    fn known_then_unknown_other_source_links() {
        let mut reg = registry("link");
        let mut l = linker();
        let t0 = Instant::now();
        l.handle(&mut reg, "04A1B2C3D4E5F6", Source::Phone, t0);
        let (card, linked) = l.handle(
            &mut reg,
            "99887766",
            Source::Reader,
            t0 + Duration::from_secs(2),
        );
        assert!(linked);
        assert_eq!(card.unwrap().aliases, vec!["99887766"]);
        assert!(reg.resolve("99887766").is_some());
    }

    #[test]
    fn no_link_when_disabled_same_source_or_too_late() {
        let t0 = Instant::now();

        let mut reg = registry("disabled");
        let mut l = Linker::default();
        l.handle(&mut reg, "04A1B2C3D4E5F6", Source::Phone, t0);
        assert!(!l.handle(&mut reg, "99887766", Source::Reader, t0).1);

        let mut reg = registry("same");
        let mut l = linker();
        l.handle(&mut reg, "04A1B2C3D4E5F6", Source::Phone, t0);
        assert!(!l.handle(&mut reg, "99887766", Source::Phone, t0).1);

        let mut reg = registry("late");
        let mut l = linker();
        l.handle(&mut reg, "04A1B2C3D4E5F6", Source::Phone, t0);
        assert!(
            !l.handle(
                &mut reg,
                "99887766",
                Source::Reader,
                t0 + Duration::from_secs(6)
            )
            .1
        );
        assert!(reg.resolve("99887766").is_none());
    }

    #[test]
    fn heuristic_match_needs_no_link() {
        let mut reg = registry("heuristic");
        let mut l = linker();
        let (card, linked) = l.handle(&mut reg, "C3B2A104", Source::Reader, Instant::now());
        assert_eq!(card.unwrap().emoji, "🐧");
        assert!(!linked);
    }
}
