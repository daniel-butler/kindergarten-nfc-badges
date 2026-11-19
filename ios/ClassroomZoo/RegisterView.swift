import SwiftUI
import UIKit

/// Register one badge at a time: scan, snap the sticker, name + cardstock color, save.
struct RegisterView: View {
    let server: String
    @ObservedObject var scanner: NFCScanner

    private enum Step {
        case idle
        case looking
        case existing(CardDTO)
        case details(id: String, existing: CardDTO?)
        case saving
        case saved(CardDTO)
        case failed(String)
    }

    @State private var step: Step = .idle
    @State private var cutout: UIImage?
    @State private var lifted = true
    @State private var showCamera = false
    @State private var cameraTarget: (id: String, existing: CardDTO?)?
    /// Set when the camera is taking a trick badge's real photo (for the reveal).
    @State private var revealFor: CardDTO?
    @State private var name = ""
    @State private var color: ColorDTO?
    @State private var role = "normal"
    private let haptics = UINotificationFeedbackGenerator()

    var body: some View {
        VStack(spacing: 18) {
            switch step {
            case .idle:
                Image("Puppy").resizable().scaledToFit().frame(height: 160).accessibilityHidden(true)
                bigButton("📛 Scan a badge to register", tint: .blue, action: scan)
                Text("Hold the badge to the top of the iPhone. Then snap its sticker.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            case .looking, .saving:
                Image("Puppy").resizable().scaledToFit().frame(height: 120).accessibilityHidden(true)
                ProgressView().controlSize(.large)
            case .existing(let card):
                existingView(card)
            case .details(let id, let existing):
                detailsView(id: id, existing: existing)
            case .saved(let card):
                art(card, local: cutout).frame(height: 180)
                Text("Saved ✓ \(card.label)").font(.title.bold())
                bigButton("📛 Scan next badge", tint: .blue, action: scan)
            case .failed(let message):
                Text("⚠️ \(message)").font(.headline).multilineTextAlignment(.center)
                bigButton("Try again", tint: .orange, action: scan)
            }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { photo in
                showCamera = false
                if let card = revealFor {
                    revealFor = nil
                    if let photo { saveRevealPhoto(photo, for: card) }
                    return
                }
                guard let photo, let target = cameraTarget else { return }
                step = .looking
                Task {
                    let result = await StickerCutout.lift(photo)
                    cutout = result.image
                    lifted = result.lifted
                    AppLog.log("register: photo \(result.lifted ? "lifted" : "not lifted, kept as taken") (\(Int(result.image.size.width))×\(Int(result.image.size.height)))")
                    step = .details(id: target.id, existing: target.existing)
                }
            }
            .ignoresSafeArea()
        }
    }

    // MARK: - Steps

    private func scan() {
        cutout = nil
        scanner.serverURL = server
        scanner.scanOnce { uid in
            step = .looking
            Task {
                switch await TapClient.resolve(id: uid, server: server) {
                case .success(let r):
                    AppLog.log("register: \(uid) is \(r.card.map { "\($0.emoji) \($0.label)" } ?? "a new badge")")
                    if let card = r.card {
                        step = .existing(card)
                    } else {
                        startDetails(id: r.canonicalID, existing: nil)
                        takePhoto(id: r.canonicalID, existing: nil)
                    }
                case .failure(let error):
                    AppLog.log("register: looking up \(uid) failed: \(error.localizedDescription)")
                    step = .failed(error.localizedDescription)
                }
            }
        }
    }

    private func saveRevealPhoto(_ photo: UIImage, for card: CardDTO) {
        step = .looking
        Task {
            let lifted = await StickerCutout.lift(photo)
            guard let png = lifted.image.pngData() else {
                step = .failed("Couldn't read the photo")
                return
            }
            switch await TapClient.uploadRevealImage(png, id: card.canonical_id, server: server) {
            case .success(let saved):
                AppLog.log("register: real photo for \(saved.label) saved")
                haptics.notificationOccurred(.success)
                step = .existing(saved)
            case .failure(let error):
                AppLog.log("register: real photo for \(card.label) failed: \(error.localizedDescription)")
                step = .failed(error.localizedDescription)
            }
        }
    }

    private func startDetails(id: String, existing: CardDTO?) {
        name = existing?.label ?? ""
        color = existing?.color
        role = existing?.role ?? "normal"
        step = .details(id: id, existing: existing)
    }

    private func takePhoto(id: String, existing: CardDTO?) {
        cameraTarget = (id, existing)
        showCamera = true
    }

    private func save(id: String, existing: CardDTO?) {
        guard let color else { return }
        let card = CardDTO(
            canonical_id: existing?.canonical_id ?? id,
            aliases: existing?.aliases ?? [],
            emoji: TapClient.emoji(forName: name),
            label: name.trimmingCharacters(in: .whitespaces),
            color: color,
            role: role,
            allowed: existing?.allowed ?? false,
            away: existing?.away ?? false,
            image: existing?.image)
        let png = cutout?.pngData()
        step = .saving
        Task {
            var result = await TapClient.upsert(card, server: server)
            if case .success(let saved) = result, let png {
                result = await TapClient.uploadImage(png, id: saved.canonical_id, server: server)
            }
            switch result {
            case .success(let saved):
                haptics.notificationOccurred(.success)
                AppLog.log("register: saved \(saved.emoji) \(saved.label) (\(saved.role)\(png == nil ? "" : ", with photo"))")
                step = .saved(saved)
            case .failure(let error):
                haptics.notificationOccurred(.error)
                AppLog.log("register: saving \(card.label) failed: \(error.localizedDescription)")
                step = .failed(error.localizedDescription)
            }
        }
    }

    private func setAway(_ card: CardDTO, _ away: Bool) {
        var updated = card
        updated.away = away
        step = .existing(updated)
        AppLog.log("register: \(card.label) \(away ? "💤 not here today" : "is here")")
        Task {
            if case .failure(let error) = await TapClient.upsert(updated, server: server) {
                AppLog.log("register: updating \(card.label) failed: \(error.localizedDescription)")
                step = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Views

    private func existingView(_ card: CardDTO) -> some View {
        VStack(spacing: 14) {
            art(card, local: nil).frame(height: 180)
            Text(card.label).font(.largeTitle.bold())
            HStack {
                Circle().fill(Color(hex: card.color.hex)).frame(width: 26, height: 26)
                    .overlay(Circle().stroke(.primary.opacity(0.4)))
                Text(card.color.name)
                if card.role == "trick" { Text("· 🎭 Trick") }
                if card.role == "special" { Text("· ⭐ Special") }
            }
            Toggle("💤 Not here today", isOn: Binding(get: { card.away }, set: { setAway(card, $0) }))
                .font(.title3.bold())
                .padding(.horizontal)
            HStack {
                Button("📸 Retake photo") {
                    startDetails(id: card.canonical_id, existing: card)
                    takePhoto(id: card.canonical_id, existing: card)
                }
                Button("✏️ Edit") { startDetails(id: card.canonical_id, existing: card) }
            }
            .buttonStyle(.bordered)
            if card.role == "trick" {
                Button(card.reveal_image == nil ? "📸 Real photo (for the reveal)" : "📸 Retake real photo ✓") {
                    revealFor = card
                    showCamera = true
                }
                .buttonStyle(.bordered)
                Text("After you keep it out, Check in can swap this real photo in with one tap.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            bigButton("📛 Scan next badge", tint: .blue, action: scan)
        }
    }

    private func detailsView(id: String, existing: CardDTO?) -> some View {
        VStack(spacing: 14) {
            ZStack {
                Checkerboard().clipShape(RoundedRectangle(cornerRadius: 12))
                if let cutout {
                    Image(uiImage: cutout).resizable().scaledToFit().padding(8)
                } else if let existing {
                    art(existing, local: nil).padding(8)
                }
            }
            .frame(height: 200)
            if cutout != nil && !lifted {
                Text("Couldn't find the sticker edges. Retake on a plain background, or keep this.")
                    .font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
            }
            Button("📸 Retake photo") { takePhoto(id: id, existing: existing) }.buttonStyle(.bordered)
            TextField("Animal name (e.g. Panda)", text: $name)
                .textFieldStyle(.roundedBorder)
                .font(.title3)
                .textInputAutocapitalization(.words)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 10) {
                ForEach(TapClient.cardstockColors, id: \.self) { c in
                    Circle()
                        .fill(Color(hex: c.hex))
                        .frame(width: 38, height: 38)
                        .overlay(Circle().stroke(color == c ? Color.orange : Color.primary.opacity(0.35), lineWidth: color == c ? 4 : 1))
                        .onTapGesture { color = c }
                        .accessibilityLabel(c.name)
                }
            }
            Text(color.map { "Cardstock: \($0.name)" } ?? "Pick the badge's cardstock color")
                .font(.footnote).foregroundStyle(.secondary)
            Picker("Role", selection: $role) {
                Text("Normal").tag("normal")
                Text("🎭 Trick").tag("trick")
                Text("⭐ Golden").tag("special")
            }
            .pickerStyle(.segmented)
            bigButton("💾 Save", tint: .green) { save(id: id, existing: existing) }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || color == nil)
            Button("Cancel") { step = .idle }
        }
    }

    @ViewBuilder
    private func art(_ card: CardDTO, local: UIImage?) -> some View {
        if let local {
            Image(uiImage: local).resizable().scaledToFit()
        } else if let path = card.image, let url = TapClient.endpoint(server: server, path: path) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                ProgressView()
            }
        } else {
            Text(card.emoji).font(.system(size: 120))
        }
    }

    private func bigButton(_ title: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.title2.bold()).frame(maxWidth: .infinity, minHeight: 64)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
    }
}

/// Transparent-area pattern behind the cutout preview.
private struct Checkerboard: View {
    var body: some View {
        Canvas { ctx, size in
            let cell: CGFloat = 12
            for row in 0..<Int(size.height / cell) + 1 {
                for col in 0..<Int(size.width / cell) + 1 where (row + col).isMultiple(of: 2) {
                    ctx.fill(Path(CGRect(x: CGFloat(col) * cell, y: CGFloat(row) * cell, width: cell, height: cell)),
                             with: .color(.gray.opacity(0.2)))
                }
            }
        }
    }
}

/// The rear camera, or the photo library where there is no camera (simulator).
private struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}

extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
                  blue: Double(value & 0xFF) / 255)
    }
}
