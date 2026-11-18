//! One log for the whole classroom setup: the server, the projector page and the phone app all
//! write here. Lines go to stdout and to `badge-server.log` next to the cards file.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static FILE: OnceLock<Mutex<File>> = OnceLock::new();

/// Longest single message kept; anything longer is cut.
pub const MAX_MESSAGE: usize = 500;

pub fn open(path: &Path) -> std::io::Result<()> {
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let _ = FILE.set(Mutex::new(file));
    Ok(())
}

/// Logs one line, e.g. `write("server", "tap from phone …")`.
pub fn write(source: &str, message: &str) {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let line = format_line(ms, source, message);
    println!("{line}");
    if let Some(file) = FILE.get() {
        let _ = writeln!(file.lock().unwrap(), "{line}");
    }
}

/// `2026-11-18T15:16:14.123Z [source] message`, on one line whatever the message holds.
pub fn format_line(ms: u64, source: &str, message: &str) -> String {
    let flat: String = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_MESSAGE)
        .collect();
    format!("{} [{source}] {flat}", timestamp(ms))
}

/// UTC, ISO 8601 with milliseconds.
pub fn timestamp(ms: u64) -> String {
    let secs = ms / 1000;
    let (h, m, s) = (secs / 3600 % 24, secs / 60 % 60, secs % 60);
    // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{:03}Z",
        ms % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_are_utc_iso() {
        assert_eq!(timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(timestamp(1_795_014_974_123), "2026-11-18T15:16:14.123Z");
        assert_eq!(timestamp(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn a_message_stays_on_one_line_and_is_capped() {
        assert_eq!(
            format_line(0, "page", "one\ntwo\r\tthree"),
            "1970-01-01T00:00:00.000Z [page] one two  three"
        );
        let long = "x".repeat(MAX_MESSAGE + 50);
        assert_eq!(
            format_line(0, "page", &long).len(),
            "1970-01-01T00:00:00.000Z [page] ".len() + MAX_MESSAGE
        );
    }
}
