//! Stamps the build with the git commit it came from, so the presenter can tell a fresh build
//! from an old one (shown at startup, in the presenter panel, and to the phone app).
use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    let commit = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let date =
        git(&["log", "-1", "--format=%cd", "--date=format:%b %-d %H:%M"]).unwrap_or_default();
    let changed =
        git(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty());
    let version = format!("{commit}{}", if changed { "+changes" } else { "" });
    println!("cargo:rustc-env=BADGE_VERSION={version}");
    println!("cargo:rustc-env=BADGE_VERSION_DATE={date}");
    // A new commit (pull, merge) means a new version.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");
    println!("cargo:rerun-if-changed=../.git/index");
}
