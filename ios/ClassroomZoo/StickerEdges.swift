import CoreGraphics
import Foundation

/// Tidies a lifted sticker: removes leftover bits of the sticker's old white border and other
/// fringe around the drawing, then adds an even white die-cut border.
///
/// Relies on the drawing having a dark outline (the classroom stickers all do): anything white or
/// see-through that can be reached from outside without crossing that outline is fringe.
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

        // Flood fill from the edges through background-like pixels.
        var outside = [Bool](repeating: false, count: w * h)
        var stack: [Int] = []
        for x in 0..<w { stack.append(x); stack.append((h - 1) * w + x) }
        for y in 0..<h { stack.append(y * w); stack.append(y * w + w - 1) }
        while let p = stack.popLast() {
            if outside[p] || !backgroundLike(p) { continue }
            outside[p] = true
            let x = p % w
            if x > 0 { stack.append(p - 1) }
            if x < w - 1 { stack.append(p + 1) }
            if p >= w { stack.append(p - w) }
            if p < w * (h - 1) { stack.append(p + w) }
        }

        // Keep the largest connected piece of what's left (drops stray specks).
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
        guard let keep = sizes.indices.max(by: { sizes[$0] < sizes[$1] }) else { return nil }
        let opaque = (0..<(w * h)).reduce(0) { $0 + (px[$1 * 4 + 3] >= 140 ? 1 : 0) }
        guard opaque > 0, Double(sizes[keep]) / Double(opaque) >= minimumKeptShare else { return nil }
        let inside = label.map { $0 == Int32(keep) }

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
