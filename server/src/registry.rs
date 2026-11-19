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
    pub color: CardColor,
    #[serde(default)]
    pub role: Role,
    /// Input only: older cards.json files marked trick badges with `"trick": true`.
    #[serde(default, rename = "trick", skip_serializing)]
    pub legacy_trick: bool,
    /// Special badges stay out of the zoo until the presenter allows them.
    #[serde(default)]
    pub allowed: bool,
    /// Served URL of the sticker cutout, e.g. `/images/04A1B2C3D4E5F6.png?v=1731871234000`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// Trick badges: the sticker's real photo, swapped in ("fix the picture") once the class has
    /// seen through the trick. While `fixed`, the two have traded places: `image` is the real
    /// photo and this holds the trick photo, ready for Reset to swap back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_image: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fixed: bool,
    /// "Not here today": left out of the zoo count until this badge is tapped.
    #[serde(default)]
    pub away: bool,
}

/// How the zoo treats a badge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Walks in and adds a tally mark.
    #[default]
    Normal,
    /// Stored animal/color deliberately wrong: the class votes on it.
    Trick,
    /// Denied until the presenter allows it; its entry starts the party.
    Special,
}

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, PartialEq)]
pub enum ImageError {
    NotFound,
    NotPng,
    TooLarge,
    Io(String),
}

/// Only URLs this server hands out are kept, so a saved card can't point the page elsewhere:
/// `/images/<HEX>.png?v=<ms>`, or `<HEX>-real.png` for a trick badge's real photo.
fn is_image_url(url: &str) -> bool {
    url.strip_prefix("/images/")
        .and_then(|rest| rest.split_once(".png?v="))
        .map(|(name, version)| (name.strip_suffix("-real").unwrap_or(name), version))
        .is_some_and(|(name, version)| {
            !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
                && name.chars().all(|c| c.is_ascii_hexdigit())
                && !version.is_empty()
                && version.chars().all(|c| c.is_ascii_digit())
        })
}

/// Cardstock color of the physical badge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardColor {
    pub hex: String,
    pub name: String,
}

fn normalize_color(color: &CardColor) -> Result<CardColor, String> {
    let digits = color.hex.trim().trim_start_matches('#');
    let name = color.name.trim();
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) || name.is_empty() {
        return Err(format!(
            "invalid color {:?} {:?}: need \"#RRGGBB\" and a name",
            color.hex, color.name
        ));
    }
    Ok(CardColor {
        hex: format!("#{}", digits.to_ascii_uppercase()),
        name: name.to_string(),
    })
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

    pub fn images_dir(&self) -> PathBuf {
        self.path.parent().unwrap_or(Path::new(".")).join("images")
    }

    /// Create or replace one card by canonical ID. Existing aliases are kept when the
    /// incoming list is empty; its photos and fixed swap are always kept.
    pub fn upsert(&mut self, card: Card) -> Result<Card, String> {
        let incoming = validate(vec![card])?.remove(0);
        let id = incoming.canonical_id.clone();
        let mut cards = self.cards.clone();
        match cards.iter_mut().find(|c| c.canonical_id == id) {
            Some(existing) => {
                let aliases = if incoming.aliases.is_empty() {
                    existing.aliases.clone()
                } else {
                    incoming.aliases.clone()
                };
                // The photos and the fixed swap belong to the server (they change through the
                // photo and fix endpoints): an edit, even from an old copy of the card, keeps them.
                *existing = Card {
                    aliases,
                    image: existing.image.clone(),
                    reveal_image: existing.reveal_image.clone(),
                    fixed: existing.fixed,
                    ..incoming
                };
            }
            None => cards.push(incoming),
        }
        self.replace(cards)?;
        Ok(self.find(&id).expect("just saved").clone())
    }

    /// Store a sticker PNG for a card and point the card at it.
    pub fn set_image(
        &mut self,
        canonical_id: &str,
        png: &[u8],
        version_ms: u64,
    ) -> Result<Card, ImageError> {
        if png.len() > MAX_IMAGE_BYTES {
            return Err(ImageError::TooLarge);
        }
        if !png.starts_with(&PNG_SIGNATURE) {
            return Err(ImageError::NotPng);
        }
        let idx = self
            .cards
            .iter()
            .position(|c| c.canonical_id == canonical_id)
            .ok_or(ImageError::NotFound)?;
        let dir = self.images_dir();
        std::fs::create_dir_all(&dir).map_err(|e| ImageError::Io(e.to_string()))?;
        write_atomic(&dir.join(format!("{canonical_id}.png")), png).map_err(ImageError::Io)?;
        let mut cards = self.cards.clone();
        let url = Some(format!("/images/{canonical_id}.png?v={version_ms}"));
        // While fixed, the badge's own (trick) photo waits in `reveal_image`.
        if cards[idx].fixed {
            cards[idx].reveal_image = url;
        } else {
            cards[idx].image = url;
        }
        self.replace(cards).map_err(ImageError::Io)?;
        Ok(self.cards[idx].clone())
    }

    /// Store a trick badge's real photo (`<id>-real.png`), to swap in with `fix`.
    pub fn set_reveal_image(
        &mut self,
        canonical_id: &str,
        png: &[u8],
        version_ms: u64,
    ) -> Result<Card, ImageError> {
        if png.len() > MAX_IMAGE_BYTES {
            return Err(ImageError::TooLarge);
        }
        if !png.starts_with(&PNG_SIGNATURE) {
            return Err(ImageError::NotPng);
        }
        let idx = self
            .cards
            .iter()
            .position(|c| c.canonical_id == canonical_id)
            .ok_or(ImageError::NotFound)?;
        let dir = self.images_dir();
        std::fs::create_dir_all(&dir).map_err(|e| ImageError::Io(e.to_string()))?;
        write_atomic(&dir.join(format!("{canonical_id}-real.png")), png).map_err(ImageError::Io)?;
        let mut cards = self.cards.clone();
        let url = Some(format!("/images/{canonical_id}-real.png?v={version_ms}"));
        if cards[idx].fixed {
            cards[idx].image = url;
        } else {
            cards[idx].reveal_image = url;
        }
        self.replace(cards).map_err(ImageError::Io)?;
        Ok(self.cards[idx].clone())
    }

    /// "Fix the picture": the badge's real photo takes the trick photo's place.
    pub fn fix(&mut self, canonical_id: &str) -> Result<Card, String> {
        let mut cards = self.cards.clone();
        let card = cards
            .iter_mut()
            .find(|c| c.canonical_id == canonical_id)
            .ok_or_else(|| format!("no card {canonical_id}"))?;
        if !card.fixed {
            if card.reveal_image.is_none() {
                return Err(format!("{} has no real photo to swap in", card.label));
            }
            std::mem::swap(&mut card.image, &mut card.reveal_image);
            card.fixed = true;
        }
        self.replace(cards)?;
        Ok(self.find(canonical_id).expect("just saved").clone())
    }

    /// Reset: every fixed badge shows its trick photo again.
    pub fn unfix_all(&mut self) -> Result<(), String> {
        let mut cards = self.cards.clone();
        for c in cards.iter_mut().filter(|c| c.fixed) {
            std::mem::swap(&mut c.image, &mut c.reveal_image);
            c.fixed = false;
        }
        self.replace(cards)
    }

    /// Allow (or deny again) every special badge.
    pub fn set_allowed_for_specials(&mut self, allowed: bool) -> Result<(), String> {
        let mut cards = self.cards.clone();
        for c in cards.iter_mut().filter(|c| c.role == Role::Special) {
            c.allowed = allowed;
        }
        self.replace(cards)
    }

    /// "Everyone's here": clear `away` on every card.
    pub fn clear_away(&mut self) -> Result<(), String> {
        let mut cards = self.cards.clone();
        for c in &mut cards {
            c.away = false;
        }
        self.replace(cards)
    }

    pub fn find(&self, canonical_id: &str) -> Option<&Card> {
        self.cards.iter().find(|c| c.canonical_id == canonical_id)
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
        if card.emoji.trim().is_empty() || card.label.trim().is_empty() {
            return Err(format!("card {canonical_id} needs an emoji and a label"));
        }
        let color = normalize_color(&card.color)?;
        let image = card.image.clone().filter(|u| is_image_url(u));
        let reveal_image = card.reveal_image.clone().filter(|u| is_image_url(u));
        let fixed = card.fixed && reveal_image.is_some();
        let role = if card.legacy_trick && card.role == Role::Normal {
            Role::Trick
        } else {
            card.role
        };
        let allowed = card.allowed && role == Role::Special;
        out.push(Card {
            canonical_id,
            aliases,
            color,
            image,
            reveal_image,
            fixed,
            role,
            legacy_trick: false,
            allowed,
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
    write_atomic(path, json.as_bytes())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    std::fs::write(&tmp, bytes)
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
            color: CardColor {
                hex: "#1e5bd8".into(),
                name: "Blue".into(),
            },
            role: Role::Normal,
            legacy_trick: false,
            allowed: false,
            image: None,
            reveal_image: None,
            fixed: false,
            away: false,
        }
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nnot-really-pixels";

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
    fn validate_normalizes_color_and_rejects_bad_ones() {
        let out = validate(vec![card("04A1B2C3D4E5F6", &[], "🐧")]).unwrap();
        assert_eq!(out[0].color.hex, "#1E5BD8");
        for (hex, name) in [("blue", "Blue"), ("#12345", "Blue"), ("#1E5BD8", " ")] {
            let mut c = card("04A1B2C3D4E5F6", &[], "🐧");
            c.color = CardColor {
                hex: hex.into(),
                name: name.into(),
            };
            assert!(validate(vec![c]).is_err(), "{hex} {name}");
        }
    }

    #[test]
    fn role_defaults_to_normal_and_legacy_trick_maps_to_trick() {
        let json = r##"[
            {"canonical_id":"04A1B2C3D4E5F6","emoji":"🐧","label":"Penguin","color":{"hex":"#1E5BD8","name":"Blue"}},
            {"canonical_id":"04999999999999","emoji":"🦁","label":"Lion","color":{"hex":"#FDD835","name":"Yellow"},"trick":true},
            {"canonical_id":"04888888888888","emoji":"⭐","label":"Star","color":{"hex":"#FDD835","name":"Yellow"},"role":"special"}
        ]"##;
        let cards = validate(serde_json::from_str(json).unwrap()).unwrap();
        assert_eq!(cards[0].role, Role::Normal);
        assert_eq!(cards[1].role, Role::Trick);
        assert_eq!(cards[2].role, Role::Special);
        assert!(!cards[2].allowed);
        let saved = serde_json::to_string(&cards).unwrap();
        assert!(saved.contains(r#""role":"trick""#), "{saved}");
        assert!(!saved.contains(r#""trick":"#), "{saved}");
    }

    #[test]
    fn set_allowed_for_specials_persists() {
        let mut reg = temp_registry("allowed");
        let mut star = card("04888888888888", &[], "⭐");
        star.role = Role::Special;
        reg.replace(vec![card("04A1B2C3D4E5F6", &[], "🐧"), star])
            .unwrap();
        reg.set_allowed_for_specials(true).unwrap();
        let reloaded = Registry::load(reg.path().to_path_buf()).unwrap();
        assert!(
            !reloaded.cards()[0].allowed,
            "normal cards are never allowed-flagged"
        );
        assert!(reloaded.cards()[1].allowed);
        reg.set_allowed_for_specials(false).unwrap();
        assert!(!reg.cards()[1].allowed);
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

    #[test]
    fn upsert_creates_then_replaces_keeping_aliases_and_image() {
        let mut reg = temp_registry("upsert");
        let created = reg
            .upsert(card("04:a1:b2:c3:d4:e5:f6", &["deadbeef"], "🐧"))
            .unwrap();
        assert_eq!(created.canonical_id, "04A1B2C3D4E5F6");
        reg.set_image("04A1B2C3D4E5F6", PNG, 7).unwrap();
        let mut changed = card("04A1B2C3D4E5F6", &[], "🦉");
        changed.label = "Owl".into();
        let updated = reg.upsert(changed).unwrap();
        assert_eq!(updated.emoji, "🦉");
        assert_eq!(updated.aliases, vec!["DEADBEEF"]);
        assert_eq!(
            updated.image.as_deref(),
            Some("/images/04A1B2C3D4E5F6.png?v=7")
        );
        assert_eq!(reg.cards().len(), 1);
        let reloaded = Registry::load(reg.path().to_path_buf()).unwrap();
        assert_eq!(reloaded.cards(), reg.cards());
    }

    #[test]
    fn upsert_rejects_duplicate_badge() {
        let mut reg = temp_registry("upsert-dup");
        reg.upsert(card("04A1B2C3D4E5F6", &[], "🐧")).unwrap();
        let err = reg.upsert(card("F6E5D4C3B2A104", &[], "🦁")).unwrap_err();
        assert!(err.contains("duplicate"), "{err}");
        assert_eq!(reg.cards().len(), 1);
    }

    #[test]
    fn set_image_writes_file_and_sets_versioned_url() {
        let mut reg = temp_registry("image");
        reg.upsert(card("04A1B2C3D4E5F6", &[], "🐧")).unwrap();
        let updated = reg.set_image("04A1B2C3D4E5F6", PNG, 42).unwrap();
        assert_eq!(
            updated.image.as_deref(),
            Some("/images/04A1B2C3D4E5F6.png?v=42")
        );
        let file = reg.images_dir().join("04A1B2C3D4E5F6.png");
        assert_eq!(std::fs::read(file).unwrap(), PNG);
    }

    #[test]
    fn set_image_rejects_non_png_unknown_and_large() {
        let mut reg = temp_registry("image-bad");
        reg.upsert(card("04A1B2C3D4E5F6", &[], "🐧")).unwrap();
        assert_eq!(
            reg.set_image("04A1B2C3D4E5F6", b"hello", 1).unwrap_err(),
            ImageError::NotPng
        );
        assert_eq!(
            reg.set_image("04999999999999", PNG, 1).unwrap_err(),
            ImageError::NotFound
        );
        let mut big = PNG.to_vec();
        big.resize(MAX_IMAGE_BYTES + 1, 0);
        assert_eq!(
            reg.set_image("04A1B2C3D4E5F6", &big, 1).unwrap_err(),
            ImageError::TooLarge
        );
        assert!(reg.cards()[0].image.is_none());
    }

    #[test]
    fn a_trick_badge_can_hold_its_real_photo_and_fix_and_reset_swap_it_in_and_out() {
        let mut reg = temp_registry("reveal");
        let mut unicorn = card("04976400092289", &[], "🦄");
        unicorn.role = Role::Trick;
        reg.replace(vec![unicorn]).unwrap();
        reg.set_image("04976400092289", PNG, 1).unwrap(); // the raccoon: the trick
        let with_real = reg.set_reveal_image("04976400092289", PNG, 2).unwrap();
        assert_eq!(
            with_real.image.as_deref(),
            Some("/images/04976400092289.png?v=1")
        );
        assert_eq!(
            with_real.reveal_image.as_deref(),
            Some("/images/04976400092289-real.png?v=2")
        );
        assert!(reg.images_dir().join("04976400092289-real.png").exists());

        let fixed = reg.fix("04976400092289").unwrap();
        assert!(fixed.fixed);
        assert_eq!(
            fixed.image.as_deref(),
            Some("/images/04976400092289-real.png?v=2"),
            "the real photo shows"
        );
        assert_eq!(
            fixed.reveal_image.as_deref(),
            Some("/images/04976400092289.png?v=1")
        );
        assert_eq!(
            reg.fix("04976400092289").unwrap(),
            fixed,
            "fixing twice changes nothing"
        );

        // Editing the card from the phone (which doesn't send these fields) keeps them.
        let mut edited = card("04976400092289", &[], "🦄");
        edited.role = Role::Trick;
        let kept = reg.upsert(edited).unwrap();
        assert!(kept.fixed);
        assert_eq!(kept.image, fixed.image);
        assert_eq!(kept.reveal_image, fixed.reveal_image);

        reg.unfix_all().unwrap();
        let back = reg.find("04976400092289").unwrap();
        assert!(!back.fixed);
        assert_eq!(
            back.image.as_deref(),
            Some("/images/04976400092289.png?v=1"),
            "reset brings the trick back"
        );
        assert_eq!(
            back.reveal_image.as_deref(),
            Some("/images/04976400092289-real.png?v=2")
        );
    }

    #[test]
    fn photos_land_in_the_right_slot_while_fixed() {
        let mut reg = temp_registry("reveal-slots");
        let mut unicorn = card("04976400092289", &[], "🦄");
        unicorn.role = Role::Trick;
        reg.replace(vec![unicorn]).unwrap();
        reg.set_image("04976400092289", PNG, 1).unwrap();
        reg.set_reveal_image("04976400092289", PNG, 2).unwrap();
        reg.fix("04976400092289").unwrap();
        let retaken = reg.set_image("04976400092289", PNG, 3).unwrap();
        assert_eq!(
            retaken.reveal_image.as_deref(),
            Some("/images/04976400092289.png?v=3"),
            "the trick photo waits"
        );
        assert_eq!(
            retaken.image.as_deref(),
            Some("/images/04976400092289-real.png?v=2"),
            "the real one still shows"
        );
        let real_again = reg.set_reveal_image("04976400092289", PNG, 4).unwrap();
        assert_eq!(
            real_again.image.as_deref(),
            Some("/images/04976400092289-real.png?v=4")
        );
    }

    #[test]
    fn an_old_copy_of_a_card_cannot_flip_or_drop_its_photos() {
        let mut reg = temp_registry("reveal-stale");
        let mut unicorn = card("04976400092289", &[], "🦄");
        unicorn.role = Role::Trick;
        reg.replace(vec![unicorn.clone()]).unwrap();
        let before_fix = reg.set_image("04976400092289", PNG, 1).unwrap();
        reg.set_reveal_image("04976400092289", PNG, 2).unwrap();
        let fixed = reg.fix("04976400092289").unwrap();
        // A Register screen opened before the fix saves its old copy (💤 or Edit).
        let mut stale = before_fix.clone();
        stale.away = true;
        let saved = reg.upsert(stale).unwrap();
        assert!(saved.away);
        assert_eq!(
            (saved.image, saved.reveal_image, saved.fixed),
            (fixed.image.clone(), fixed.reveal_image.clone(), true)
        );
        let mut stale_edit = before_fix;
        stale_edit.reveal_image = None;
        let saved = reg.upsert(stale_edit).unwrap();
        assert_eq!(
            (saved.image, saved.reveal_image),
            (fixed.image, fixed.reveal_image)
        );
    }

    #[test]
    fn fixed_needs_a_real_photo_to_mean_anything() {
        let mut c = card("04976400092289", &[], "🦄");
        c.fixed = true;
        assert!(!validate(vec![c]).unwrap()[0].fixed);
    }

    #[test]
    fn fixing_needs_a_real_photo() {
        let mut reg = temp_registry("reveal-missing");
        reg.replace(vec![card("04976400092289", &[], "🦄")])
            .unwrap();
        assert!(reg.fix("04976400092289").is_err());
        assert!(reg.fix("04DEADBEEF0000").is_err());
    }

    #[test]
    fn real_photo_urls_are_allowed_but_only_ours() {
        assert!(is_image_url("/images/04976400092289-real.png?v=2"));
        assert!(!is_image_url("/images/04976400092289-fake.png?v=2"));
        assert!(!is_image_url("/images/../x-real.png?v=2"));
    }

    #[test]
    fn validate_drops_image_urls_that_are_not_ours() {
        let mut ok = card("04A1B2C3D4E5F6", &[], "🐧");
        ok.image = Some("/images/04A1B2C3D4E5F6.png?v=5".into());
        let mut bad = card("04999999999999", &[], "🦁");
        bad.image = Some("javascript:alert(1)".into());
        let out = validate(vec![ok, bad]).unwrap();
        assert_eq!(
            out[0].image.as_deref(),
            Some("/images/04A1B2C3D4E5F6.png?v=5")
        );
        assert_eq!(out[1].image, None);
    }

    #[test]
    fn clear_away_resets_all() {
        let mut reg = temp_registry("away");
        let mut a = card("04A1B2C3D4E5F6", &[], "🐧");
        a.away = true;
        reg.upsert(a).unwrap();
        assert!(reg.cards()[0].away);
        reg.clear_away().unwrap();
        assert!(!reg.cards()[0].away);
    }
}
