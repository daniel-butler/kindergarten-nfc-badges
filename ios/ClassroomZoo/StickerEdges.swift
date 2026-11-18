import CoreGraphics
import Foundation

/// Tidies a lifted sticker: removes leftover bits of the sticker's old white border and other
/// fringe around the drawing, then adds an even white die-cut border.
///
/// Relies on the drawing having a dark outline (the classroom stickers all do). First choice: keep
/// what that outline encloses, so paper, the sheet's cut line and shadows outside it all go, and a
/// white animal keeps its white. If the outline doesn't enclose the drawing, fall back to: anything
/// white or see-through that can be reached from outside without crossing the outline is fringe.
enum StickerEdges {
    /// If cleaning would keep less than this share of the original sticker, the outline assumption
    /// failed and the original cutout is better.
    static let minimumKeptShare = 0.3

    static func borderRadius(forWidth width: Int, height: Int) -> Int {
        max(3, Int((Double(max(width, height)) * 0.022).rounded()))
    }

    /// Transparent margin added on every side so the new border is never cut off.
    static func padding(forWidth width: Int, height: Int) -> Int {
        borderRadius(forWidth: width, height: height) + 1
    }

    /// The outline is thickened by this much so small gaps in it don't let the outside in.
    static func gapRadius(forWidth width: Int, height: Int) -> Int {
        max(2, Int((Double(max(width, height)) * 0.004).rounded()))
    }

    /// Returns the cleaned image, grown by `padding` on every side, or nil to keep the original.
    static func clean(_ image: CGImage) -> CGImage? {
        guard image.width > 2, image.height > 2 else { return nil }
        let pad = padding(forWidth: image.width, height: image.height)
        let radius = borderRadius(forWidth: image.width, height: image.height)
        let w = image.width + 2 * pad, h = image.height + 2 * pad
        let rgb = CGColorSpaceCreateDeviceRGB()
        func context() -> CGContext? {
            CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: rgb,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        }
        guard let input = context() else { return nil }
        input.draw(image, in: CGRect(x: pad, y: pad, width: image.width, height: image.height))
        let px = input.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)

        // Mostly transparent, or near-white and unsaturated.
        func backgroundLike(_ p: Int) -> Bool {
            let i = p * 4
            let a = Int(px[i + 3])
            if a < 140 { return true }
            let r = Int(px[i]) * 255 / a, g = Int(px[i + 1]) * 255 / a, b = Int(px[i + 2]) * 255 / a
            return min(r, g, b) > 215 && max(r, g, b) - min(r, g, b) < 30
        }

        // The outline's dark ink, thickened to close small gaps.
        func dark(_ p: Int) -> Bool {
            let i = p * 4
            let a = Int(px[i + 3])
            guard a >= 140 else { return false }
            let luma = (Int(px[i]) * 299 + Int(px[i + 1]) * 587 + Int(px[i + 2]) * 114) * 255 / (1000 * a)
            return luma < 110
        }
        let gap = gapRadius(forWidth: image.width, height: image.height)
        var wall = [Bool](repeating: false, count: w * h)
        for y in 0..<h { for x in 0..<w where dark(y * w + x) {
            for ny in max(0, y - gap)...min(h - 1, y + gap) { for nx in max(0, x - gap)...min(w - 1, x + gap) {
                wall[ny * w + nx] = true
            } }
        } }

        let opaque = (0..<(w * h)).reduce(0) { $0 + (px[$1 * 4 + 3] >= 140 ? 1 : 0) }
        guard opaque > 0 else { return nil }

        /// Floods from the image edges through `passable` pixels, then returns the largest piece of
        /// what the flood didn't reach (dropping stray specks), or nil if that's too little to trust.
        func drawing(_ passable: (Int) -> Bool) -> [Bool]? {
            var outside = [Bool](repeating: false, count: w * h)
            var stack: [Int] = []
            for x in 0..<w { stack.append(x); stack.append((h - 1) * w + x) }
            for y in 0..<h { stack.append(y * w); stack.append(y * w + w - 1) }
            while let p = stack.popLast() {
                if outside[p] || !passable(p) { continue }
                outside[p] = true
                let x = p % w
                if x > 0 { stack.append(p - 1) }
                if x < w - 1 { stack.append(p + 1) }
                if p >= w { stack.append(p - w) }
                if p < w * (h - 1) { stack.append(p + w) }
            }
            var label = [Int32](repeating: -1, count: w * h)
            var sizes: [Int] = []
            for start in 0..<(w * h) where !outside[start] && label[start] < 0 {
                let id = Int32(sizes.count)
                var count = 0
                label[start] = id
                stack = [start]
                while let p = stack.popLast() {
                    count += 1
                    let x = p % w
                    for q in [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]
                    where q >= 0 && !outside[q] && label[q] < 0 {
                        label[q] = id
                        stack.append(q)
                    }
                }
                sizes.append(count)
            }
            guard let keep = sizes.indices.max(by: { sizes[$0] < sizes[$1] }),
                  Double(sizes[keep]) / Double(opaque) >= minimumKeptShare else { return nil }
            return label.map { $0 == Int32(keep) }
        }

        let inside: [Bool]
        if var enclosed = drawing({ !wall[$0] }) {
            // Give back the thickening: peel the paper it added just outside the ink.
            for _ in 0..<gap {
                let rim = (0..<(w * h)).filter { p in
                    guard enclosed[p], !dark(p) else { return false }
                    let x = p % w
                    return x == 0 || x == w - 1 || p < w || p >= w * (h - 1)
                        || !enclosed[p - 1] || !enclosed[p + 1] || !enclosed[p - w] || !enclosed[p + w]
                }
                for p in rim { enclosed[p] = false }
            }
            inside = enclosed
        } else if let reachable = drawing(backgroundLike) {
            inside = reachable
        } else {
            return nil
        }

        // New border: stamp a round brush on the drawing's edge pixels.
        var brush: [(Int, Int)] = []
        for dy in -radius...radius { for dx in -radius...radius where dx * dx + dy * dy <= radius * radius { brush.append((dx, dy)) } }
        var border = [Bool](repeating: false, count: w * h)
        for y in 0..<h { for x in 0..<w {
            let p = y * w + x
            guard inside[p] else { continue }
            let edge = x == 0 || y == 0 || x == w - 1 || y == h - 1
                || !inside[p - 1] || !inside[p + 1] || !inside[p - w] || !inside[p + w]
            guard edge else { continue }
            for (dx, dy) in brush {
                let nx = x + dx, ny = y + dy
                if nx >= 0, ny >= 0, nx < w, ny < h { border[ny * w + nx] = true }
            }
        } }

        guard let output = context() else { return nil }
        let o = output.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)
        for p in 0..<(w * h) {
            let i = p * 4
            if inside[p] {
                // Semi-transparent drawing edges sit on white, not on nothing.
                let lift = 255 - Int(px[i + 3])
                o[i] = UInt8(Int(px[i]) + lift); o[i + 1] = UInt8(Int(px[i + 1]) + lift)
                o[i + 2] = UInt8(Int(px[i + 2]) + lift); o[i + 3] = 255
            } else if border[p] {
                o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = 255
            }
        }
        return output.makeImage()
    }
}
