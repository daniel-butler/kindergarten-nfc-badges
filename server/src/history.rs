//! Recent live events, so a projector page that reconnects can catch up on what it missed
//! (a kid's tap during a network blip still gets them into the zoo).

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// A page that was gone longer than this starts fresh rather than replaying old taps.
pub const MAX_AGE: Duration = Duration::from_secs(120);
pub const MAX_EVENTS: usize = 100;

/// The SSE event id for event `id` of the server run `boot`: `<boot>-<id>`.
pub fn event_id(boot: u64, id: u64) -> String {
    format!("{boot}-{id}")
}

pub struct History<T> {
    /// Changes every time the server starts, so a page doesn't replay against a different run.
    boot: u64,
    next: u64,
    recent: VecDeque<(u64, Instant, T)>,
}

impl<T: Clone> History<T> {
    pub fn new(boot: u64) -> Self {
        Self {
            boot,
            next: 1,
            recent: VecDeque::new(),
        }
    }

    pub fn boot(&self) -> u64 {
        self.boot
    }

    /// The id of the newest event so far (0 before any).
    pub fn last(&self) -> u64 {
        self.next - 1
    }

    /// Records an event and returns its id.
    pub fn push(&mut self, item: T, now: Instant) -> u64 {
        let id = self.next;
        self.next += 1;
        self.recent.push_back((id, now, item));
        while self.recent.len() > MAX_EVENTS {
            self.recent.pop_front();
        }
        id
    }

    /// Events after `last` that are still fresh, oldest first.
    pub fn since(&self, last: u64, now: Instant) -> Vec<(u64, T)> {
        self.recent
            .iter()
            .filter(|(id, at, _)| *id > last && now.duration_since(*at) <= MAX_AGE)
            .map(|(id, _, item)| (*id, item.clone()))
            .collect()
    }

    /// The last event a reconnecting page saw, if it saw it from this run of the server.
    pub fn parse_last(&self, header: &str) -> Option<u64> {
        let (boot, id) = header.trim().split_once('-')?;
        (boot.parse::<u64>().ok()? == self.boot)
            .then(|| id.parse().ok())
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replays_only_events_after_the_last_one_seen() {
        let mut h = History::new(7);
        let t = Instant::now();
        let a = h.push("a", t);
        h.push("b", t);
        h.push("c", t);
        assert_eq!(h.since(a, t), vec![(2, "b"), (3, "c")]);
        assert_eq!(h.since(3, t), vec![]);
        assert_eq!(h.last(), 3);
    }

    #[test]
    fn old_events_are_not_replayed() {
        let mut h = History::new(7);
        let t = Instant::now();
        h.push("old", t);
        h.push("new", t + MAX_AGE);
        assert_eq!(
            h.since(0, t + MAX_AGE + Duration::from_secs(1)),
            vec![(2, "new")]
        );
    }

    #[test]
    fn keeps_at_most_max_events() {
        let mut h = History::new(7);
        let t = Instant::now();
        for i in 0..MAX_EVENTS + 5 {
            h.push(i, t);
        }
        let all = h.since(0, t);
        assert_eq!(all.len(), MAX_EVENTS);
        assert_eq!(all[0].0, 6);
    }

    #[test]
    fn event_ids_only_match_the_same_server_run() {
        let h: History<()> = History::new(1700);
        assert_eq!(event_id(h.boot(), 5), "1700-5");
        assert_eq!(h.parse_last("1700-5"), Some(5));
        assert_eq!(h.parse_last("1699-5"), None);
        assert_eq!(h.parse_last("nonsense"), None);
    }
}
