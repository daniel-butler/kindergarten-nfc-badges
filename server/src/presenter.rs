//! What the phone's Presenter tab shows, and the remote commands the page understands.

use serde::Serialize;

use crate::registry::{Card, Role};

/// Every action a key press or a phone button can send.
pub const COMMANDS: [&str; 13] = [
    "scene-setup",
    "scene-secret",
    "scene-zoo",
    "scene-list",
    "scene-who",
    "scene-gate",
    "scene-debug",
    "toggle-list",
    "let-in",
    "keep-out",
    "allow-special",
    "party",
    "reset",
];

pub fn parse_command(action: &str) -> Option<&'static str> {
    COMMANDS.iter().copied().find(|c| *c == action)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WaitingKind {
    Trick,
    Special,
}

#[derive(Debug, Clone, Serialize)]
pub struct Waiting {
    pub kind: WaitingKind,
    pub card: Card,
    pub raw_id: String,
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Unknown {
    pub raw_id: String,
    pub ts: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PresenterState {
    pub waiting: Option<Waiting>,
    pub last_unknown: Option<Unknown>,
}

impl PresenterState {
    /// Update from a tap: `card` is what the tap resolved to (None = unknown badge).
    pub fn observe(&mut self, raw_id: &str, card: Option<&Card>, ts: u64) {
        let Some(card) = card else {
            self.last_unknown = Some(Unknown {
                raw_id: raw_id.to_string(),
                ts,
            });
            return;
        };
        let kind = match card.role {
            Role::Trick => WaitingKind::Trick,
            Role::Special if !card.allowed => WaitingKind::Special,
            Role::Special => {
                self.waiting = None;
                return;
            }
            Role::Normal => return,
        };
        self.waiting = Some(Waiting {
            kind,
            card: card.clone(),
            raw_id: raw_id.to_string(),
            ts,
        });
    }

    /// A trick vote was decided.
    pub fn clear_trick(&mut self) {
        if self
            .waiting
            .as_ref()
            .is_some_and(|w| w.kind == WaitingKind::Trick)
        {
            self.waiting = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::CardColor;

    fn card(role: Role, allowed: bool) -> Card {
        Card {
            canonical_id: "04A1B2C3D4E5F6".into(),
            aliases: vec![],
            emoji: "🐧".into(),
            label: "Penguin".into(),
            color: CardColor {
                hex: "#1E5BD8".into(),
                name: "Blue".into(),
            },
            role,
            legacy_trick: false,
            allowed,
            image: None,
            away: false,
        }
    }

    #[test]
    fn presenter_records_waiting_and_unknown() {
        let mut p = PresenterState::default();
        p.observe("deadbeef", None, 1);
        assert_eq!(p.last_unknown.as_ref().unwrap().raw_id, "deadbeef");

        p.observe("x", Some(&card(Role::Trick, false)), 2);
        assert_eq!(p.waiting.as_ref().unwrap().kind, WaitingKind::Trick);
        p.observe("y", Some(&card(Role::Normal, false)), 3);
        assert_eq!(
            p.waiting.as_ref().unwrap().raw_id,
            "x",
            "normal taps don't clear it"
        );
        p.clear_trick();
        assert!(p.waiting.is_none());

        p.observe("s", Some(&card(Role::Special, false)), 4);
        assert_eq!(p.waiting.as_ref().unwrap().kind, WaitingKind::Special);
        p.clear_trick();
        assert!(
            p.waiting.is_some(),
            "deciding a trick doesn't clear a waiting special"
        );
        p.observe("s", Some(&card(Role::Special, true)), 5);
        assert!(p.waiting.is_none(), "an allowed special going in clears it");
    }

    #[test]
    fn command_names_parse() {
        assert_eq!(parse_command("let-in"), Some("let-in"));
        assert_eq!(parse_command("reset"), Some("reset"));
        assert_eq!(parse_command("scene-zoo"), Some("scene-zoo"));
        assert_eq!(parse_command("nope"), None);
        assert_eq!(parse_command(""), None);
    }
}
