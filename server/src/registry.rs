use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::ids;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Card {
    pub canonical_id: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub emoji: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

impl Card {
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.canonical_id.as_str()).chain(self.aliases.iter().map(String::as_str))
    }
}

pub struct Registry {
    path: PathBuf,
    cards: Vec<Card>,
}

impl Registry {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let cards = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("{} is not valid cards JSON: {e}", path.display()))
                .and_then(validate)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("cannot read {}: {e}", path.display())),
        };
        Ok(Self { path, cards })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn cards(&self) -> &[Card] {
        &self.cards
    }

    pub fn resolve(&self, canonical_id: &str) -> Option<&Card> {
        ids::resolve(self.cards.iter().map(Card::ids), canonical_id).map(|(i, _)| &self.cards[i])
    }

    /// Validate, replace, and persist the whole registry.
    pub fn replace(&mut self, cards: Vec<Card>) -> Result<(), String> {
        let cards = validate(cards)?;
        save(&self.path, &cards)?;
        self.cards = cards;
        Ok(())
    }

    /// Attach `alias` to the card whose canonical ID is `card_id`.
    pub fn add_alias(&mut self, card_id: &str, alias: &str) -> Result<Card, String> {
        let mut cards = self.cards.clone();
        let card = cards
            .iter_mut()
            .find(|c| c.canonical_id == card_id)
            .ok_or_else(|| format!("no card {card_id}"))?;
        card.aliases.push(alias.to_string());
        let linked = card.clone();
        self.replace(cards)?;
        Ok(linked)
    }
}

/// Normalize every ID and reject any badge that would match two different cards
/// (exactly, reversed, or via 4-byte truncation).
pub fn validate(cards: Vec<Card>) -> Result<Vec<Card>, String> {
    let mut out = Vec::with_capacity(cards.len());
    for card in cards {
        let canonical_id = ids::normalize(&card.canonical_id)
            .ok_or_else(|| format!("invalid card id {:?}", card.canonical_id))?;
        let mut aliases: Vec<String> = Vec::new();
        for raw in &card.aliases {
            let alias = ids::normalize(raw).ok_or_else(|| format!("invalid alias {raw:?}"))?;
            if alias != canonical_id && !aliases.contains(&alias) {
                aliases.push(alias);
            }
        }
        out.push(Card {
            canonical_id,
            aliases,
            ..card
        });
    }
    for (i, a) in out.iter().enumerate() {
        for b in &out[i + 1..] {
            for id_a in a.ids() {
                if let Some(id_b) = b.ids().find(|id_b| ids::match_kind(id_a, id_b).is_some()) {
                    return Err(format!(
                        "duplicate badge: {id_a} ({} {}) and {id_b} ({} {}) are the same badge",
                        a.emoji, a.label, b.emoji, b.label
                    ));
                }
            }
        }
    }
    Ok(out)
}

fn save(path: &Path, cards: &[Card]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cards).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)
        .and_then(|()| std::fs::rename(&tmp, path))
        .map_err(|e| format!("cannot write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, aliases: &[&str], emoji: &str) -> Card {
        Card {
            canonical_id: id.into(),
            aliases: aliases.iter().map(|s| s.to_string()).collect(),
            emoji: emoji.into(),
            label: "x".into(),
            color: None,
        }
    }

    fn temp_registry(name: &str) -> Registry {
        let dir = std::env::temp_dir().join(format!("badge-test-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.json");
        let _ = std::fs::remove_file(&path);
        Registry::load(path).unwrap()
    }

    #[test]
    fn validate_normalizes_and_dedupes_aliases() {
        let out = validate(vec![card(
            "04:a1:b2:c3:d4:e5:f6",
            &["04a1b2c3d4e5f6", "deadbeef", "DEADBEEF"],
            "🐧",
        )])
        .unwrap();
        assert_eq!(out[0].canonical_id, "04A1B2C3D4E5F6");
        assert_eq!(out[0].aliases, vec!["DEADBEEF"]);
    }

    #[test]
    fn validate_rejects_same_badge_on_two_cards() {
        let exact = vec![
            card("04A1B2C3D4E5F6", &[], "🐧"),
            card("04a1b2c3d4e5f6", &[], "🦁"),
        ];
        assert!(validate(exact).unwrap_err().contains("duplicate"));
        let reversed = vec![
            card("04A1B2C3D4E5F6", &[], "🐧"),
            card("F6E5D4C3B2A104", &[], "🦁"),
        ];
        assert!(validate(reversed).is_err());
        let truncated = vec![
            card("04A1B2C3D4E5F6", &[], "🐧"),
            card("11111111111111", &["C3B2A104"], "🦁"),
        ];
        assert!(validate(truncated).is_err());
    }

    #[test]
    fn validate_rejects_bad_hex() {
        assert!(validate(vec![card("zebra", &[], "🦓")]).is_err());
    }

    #[test]
    fn replace_persists_and_reloads() {
        let mut reg = temp_registry("persist");
        reg.replace(vec![card("04A1B2C3D4E5F6", &[], "🐧")])
            .unwrap();
        let reloaded = Registry::load(reg.path().to_path_buf()).unwrap();
        assert_eq!(reloaded.cards(), reg.cards());
    }

    #[test]
    fn add_alias_links_unrelated_reader_id() {
        let mut reg = temp_registry("alias");
        reg.replace(vec![card("04A1B2C3D4E5F6", &[], "🐧")])
            .unwrap();
        reg.add_alias("04A1B2C3D4E5F6", "12345678").unwrap();
        assert_eq!(reg.resolve("12345678").unwrap().emoji, "🐧");
    }

    #[test]
    fn add_alias_refuses_id_owned_by_other_card() {
        let mut reg = temp_registry("conflict");
        reg.replace(vec![
            card("04A1B2C3D4E5F6", &[], "🐧"),
            card("04999999999999", &[], "🦁"),
        ])
        .unwrap();
        assert!(reg.add_alias("04A1B2C3D4E5F6", "04999999999999").is_err());
        assert!(reg.resolve("04999999999999").unwrap().emoji == "🦁");
    }
}
