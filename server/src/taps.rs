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
    /// A trick vote or the special badge now waiting for the presenter because of this tap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting: Option<crate::presenter::WaitingKind>,
}

/// What a tap did: the card it resolved to, whether it just linked an alias, and whether
/// the registry changed (a link or clearing "not here today"), so listeners need new cards.
#[derive(Debug)]
pub struct TapOutcome {
    pub card: Option<Card>,
    pub linked: bool,
    pub cards_changed: bool,
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
    ) -> TapOutcome {
        let (mut card, linked) = self.resolve_and_link(registry, canonical_id, source, now);
        let mut cards_changed = linked;
        if let Some(c) = card.as_mut().filter(|c| c.away) {
            c.away = false;
            match registry.upsert(c.clone()) {
                Ok(saved) => {
                    *c = saved;
                    cards_changed = true;
                }
                Err(e) => eprintln!("could not clear away: {e}"),
            }
        }
        TapOutcome {
            card,
            linked,
            cards_changed,
        }
    }

    fn resolve_and_link(
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
            color: crate::registry::CardColor {
                hex: "#1E5BD8".into(),
                name: "Blue".into(),
            },
            role: crate::registry::Role::Normal,
            legacy_trick: false,
            allowed: false,
            image: None,
            away: false,
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
        let TapOutcome { card, linked, .. } = l.handle(
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
        assert!(!l.handle(&mut reg, "99887766", Source::Reader, t0).linked);

        let mut reg = registry("same");
        let mut l = linker();
        l.handle(&mut reg, "04A1B2C3D4E5F6", Source::Phone, t0);
        assert!(!l.handle(&mut reg, "99887766", Source::Phone, t0).linked);

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
            .linked
        );
        assert!(reg.resolve("99887766").is_none());
    }

    #[test]
    fn heuristic_match_needs_no_link() {
        let mut reg = registry("heuristic");
        let mut l = linker();
        let TapOutcome { card, linked, .. } =
            l.handle(&mut reg, "C3B2A104", Source::Reader, Instant::now());
        assert_eq!(card.unwrap().emoji, "🐧");
        assert!(!linked);
    }

    #[test]
    fn tap_on_away_card_clears_it() {
        let mut reg = registry("away");
        let mut card = reg.cards()[0].clone();
        card.away = true;
        reg.upsert(card).unwrap();
        let mut l = Linker::default();
        let TapOutcome { card, .. } =
            l.handle(&mut reg, "04A1B2C3D4E5F6", Source::Reader, Instant::now());
        assert!(!card.unwrap().away);
        assert!(!reg.cards()[0].away);
        let reloaded = Registry::load(reg.path().to_path_buf()).unwrap();
        assert!(!reloaded.cards()[0].away);
    }
}
