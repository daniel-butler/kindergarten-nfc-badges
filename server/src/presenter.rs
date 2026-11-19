//! What the phone's Presenter tab shows, and the remote commands the page understands.

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Trick badges the class let in: inside now, so their taps don't wait for a vote.
    #[serde(skip)]
    let_in: Vec<String>,
}

impl PresenterState {
    /// Update from a tap: `card` is what the tap resolved to (None = unknown badge). Returns
    /// what now waits for the presenter because of this tap.
    pub fn observe(&mut self, raw_id: &str, card: Option<&Card>, ts: u64) -> Option<WaitingKind> {
        let Some(card) = card else {
            self.last_unknown = Some(Unknown {
                raw_id: raw_id.to_string(),
                ts,
            });
            return None;
        };
        let kind = match card.role {
            Role::Trick if self.let_in.contains(&card.canonical_id) => return None,
            Role::Trick => WaitingKind::Trick,
            Role::Special if !card.allowed => WaitingKind::Special,
            Role::Special => {
                self.waiting = None;
                return None;
            }
            Role::Normal => return None,
        };
        self.waiting = Some(Waiting {
            kind,
            card: card.clone(),
            raw_id: raw_id.to_string(),
            ts,
        });
        Some(kind)
    }

    /// The class decided the waiting trick badge's vote. Kept out isn't final: its next tap
    /// gets a new vote.
    pub fn decide_trick(&mut self, let_in: bool) {
        if let Some(w) = self.waiting.take_if(|w| w.kind == WaitingKind::Trick)
            && let_in
        {
            self.let_in.push(w.card.canonical_id);
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
            reveal_image: None,
            fixed: false,
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
        p.decide_trick(false);
        assert!(p.waiting.is_none());

        p.observe("s", Some(&card(Role::Special, false)), 4);
        assert_eq!(p.waiting.as_ref().unwrap().kind, WaitingKind::Special);
        p.decide_trick(true);
        assert!(
            p.waiting.is_some(),
            "deciding a trick doesn't clear a waiting special"
        );
        p.observe("s", Some(&card(Role::Special, true)), 5);
        assert!(p.waiting.is_none(), "an allowed special going in clears it");
    }

    #[test]
    fn a_trick_that_was_let_in_is_not_waiting_again() {
        let mut p = PresenterState::default();
        let fox = card(Role::Trick, false);
        assert_eq!(p.observe("x", Some(&fox), 1), Some(WaitingKind::Trick));
        p.decide_trick(true);
        assert!(p.waiting.is_none());
        assert_eq!(p.observe("x", Some(&fox), 2), None, "it's inside now");
        assert!(p.waiting.is_none());
    }

    #[test]
    fn a_trick_that_was_kept_out_gets_another_vote_next_time() {
        let mut p = PresenterState::default();
        let fox = card(Role::Trick, false);
        p.observe("x", Some(&fox), 1);
        p.decide_trick(false);
        assert!(p.waiting.is_none());
        assert_eq!(p.observe("x", Some(&fox), 2), Some(WaitingKind::Trick));
    }

    #[test]
    fn observe_says_what_is_waiting_because_of_this_tap() {
        let mut p = PresenterState::default();
        assert_eq!(p.observe("u", None, 1), None);
        assert_eq!(p.observe("n", Some(&card(Role::Normal, false)), 2), None);
        assert_eq!(
            p.observe("s", Some(&card(Role::Special, false)), 3),
            Some(WaitingKind::Special)
        );
        assert_eq!(p.observe("s", Some(&card(Role::Special, true)), 4), None);
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
