# 🛠️ Setup guide

[← Back to the README](../README.md) · [Presenter guide](presenter-guide.md) · [Developer guide](developer.md)

## Run the server

```sh
cd server
cargo run --release -- --cards ~/cards.json      # binds 0.0.0.0:8080
cargo run --release -- --port 9000 --cards ~/cards.json
```

On startup it prints the cards file and the Mac's network addresses (use the `en0` one in the
phone app). Without `--cards`, `cards.json` lives next to the binary inside `target/`, which
`cargo clean` deletes, so always pass `--cards` for the real badge list. Sticker photos are saved
in an `images/` folder next to that file.

The projector page is `http://localhost:8080/` on the Mac.

## Connect the phone (iPhone hotspot, no internet needed)

1. iPhone: Settings → Personal Hotspot → **Allow Others to Join** on. Keep this screen open while
   the Mac joins.
2. Mac: join the iPhone's Wi‑Fi network.
3. Start the server. Note the `Phone app URL: http://172.20.10.x:8080` line it prints.
4. In Zookeeper, enter that URL (allow Local Network access when asked). The line under it shows
   "🟢 Connected · N badges", or "🔴 Can't reach the Mac" with the reason. It re-checks every
   10 seconds and whenever you reopen the app; **Reconnect** checks right away.

**If it doesn't connect:**
- Check that the server window is still running.
- Check that the phone isn't using cellular instead of the shared Wi‑Fi.
- Check Settings → Privacy & Security → Local Network → **Zookeeper** is on.
- Check the macOS Firewall allows `badge-server`.

At home, the same Wi‑Fi works too. With Tailscale on both devices, the Mac's Tailscale address
works from anywhere.

## Install Zookeeper on the iPhone

1. Open `ios/ClassroomZoo.xcodeproj` in Xcode and sign in to your developer account (Xcode →
   Settings → Accounts). Signing is preset to team `K7T7J4BD4W` and bundle ID
   `com.rekuro.ClassroomZoo`; change both under *Signing & Capabilities* if needed. Xcode
   registers the App ID with **NFC Tag Reading** on the first build.
2. Pick the iPhone as the run destination (cable or Wi‑Fi) and press **Run**.
3. The first time only: on the iPhone, turn on Settings → Privacy & Security → **Developer Mode**,
   and trust the developer certificate under Settings → General → VPN & Device Management.

## Register badges (Zookeeper → Register)

About 20 seconds per badge:

1. **Scan a badge to register** and hold the badge to the top of the phone.
2. For a new badge, the camera opens. Snap the sticker straight on. The app lifts it off the
   cardstock and tidies the edges: leftover bits of the old white border are removed, and an even
   white die-cut border is drawn around the drawing's dark outline. **Retake** if it looks wrong.
3. Type the animal's name, tap its cardstock color, pick its role (Normal / 🎭 Trick / ⭐ Golden),
   and tap **Save**. The photo shows up on the projector right away.
4. A badge that's already registered shows **📸 Retake photo**, **✏️ Edit** and
   **💤 Not here today**.

You can also register in the projector's **⌥1 Setup** scene (emoji instead of photos).

## Using the USB reader too

The reader may send a badge's ID shortened or reversed compared with the phone. Matching handles
that automatically. For a badge it doesn't recognize, open **⌥1 Setup**, tap the badge on the
phone, then on the reader within 5 seconds: the reader's ID gets linked to that card.

## Check in mode (Zookeeper → Check in)

Tap **Start Scanning** and hold badges to the phone one after another. Each read buzzes, sends the
tap, shows the animal, and keeps scanning. iOS ends an NFC session after about a minute; Zookeeper
starts a new one by itself until you tap **Stop** (or Cancel on the scan sheet). The screen stays
awake while you're on Check in. A badge left on the phone isn't re-sent within 2 seconds.

## Logs on the phone

Tap **📝 Logs** in Zookeeper to see what the app did: opened, backgrounded, badge reads, what it
sent and any errors. **Copy** puts it on the clipboard to paste into a message, and **Share** sends
it as a file. The same lines also go to `~/badge-server.log` on the Mac whenever the app can reach
it (see the [developer guide](developer.md#the-shared-log)).
