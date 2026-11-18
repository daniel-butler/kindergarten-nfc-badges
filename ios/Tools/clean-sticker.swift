// Regenerates the Zoo Tap puppy art from Tools/puppy-source.png:
//   swiftc -O Tools/clean-sticker.swift -o /tmp/clean-sticker && /tmp/clean-sticker Tools/puppy-source.png \
//     ClassroomZoo/Assets.xcassets/Puppy.imageset/Puppy.png ClassroomZoo/Assets.xcassets/AppIcon.appiconset/AppIcon.png
// Usage: clean-sticker <in.png> <out-sticker.png> <out-icon.png>
// Removes white/transparent fringe reachable from outside without crossing the dark outline,
// adds an even white die-cut border, writes the sticker (transparent) and a 1024px app icon.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let src = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil)!, 0, nil)!
let scale = 3 // work at 3× so the new border is smooth
let pad = 14 * scale
let W = src.width * scale + pad * 2, H = src.height * scale + pad * 2
let rgb = CGColorSpaceCreateDeviceRGB()

func context(_ w: Int, _ h: Int) -> CGContext {
    CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: rgb,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

let ctx = context(W, H)
ctx.interpolationQuality = .high
ctx.draw(src, in: CGRect(x: pad, y: pad, width: src.width * scale, height: src.height * scale))
let px = ctx.data!.bindMemory(to: UInt8.self, capacity: W * H * 4)

@inline(__always) func at(_ x: Int, _ y: Int) -> Int { (y * W + x) * 4 }

// Background-like: mostly transparent, or near-white and unsaturated (old sticker border).
func backgroundLike(_ i: Int) -> Bool {
    let a = Int(px[i + 3])
    if a < 140 { return true }
    let r = Int(px[i]) * 255 / a, g = Int(px[i + 1]) * 255 / a, b = Int(px[i + 2]) * 255 / a
    return min(r, g, b) > 215 && max(r, g, b) - min(r, g, b) < 30
}

// Flood fill from the border through background-like pixels.
var outside = [Bool](repeating: false, count: W * H)
var stack: [Int] = []
for x in 0..<W { stack.append(x); stack.append((H - 1) * W + x) }
for y in 0..<H { stack.append(y * W); stack.append(y * W + W - 1) }
while let p = stack.popLast() {
    if outside[p] || !backgroundLike(p * 4) { continue }
    outside[p] = true
    let x = p % W, y = p / W
    if x > 0 { stack.append(p - 1) }
    if x < W - 1 { stack.append(p + 1) }
    if y > 0 { stack.append(p - W) }
    if y < H - 1 { stack.append(p + W) }
}

// Keep only the largest connected drawing (drops stray specks).
var label = [Int](repeating: -1, count: W * H)
var sizes: [Int] = []
for start in 0..<(W * H) where !outside[start] && label[start] < 0 {
    let id = sizes.count
    var count = 0
    stack = [start]
    label[start] = id
    while let p = stack.popLast() {
        count += 1
        let x = p % W, y = p / W
        for q in [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]
        where q >= 0 && !outside[q] && label[q] < 0 {
            label[q] = id
            stack.append(q)
        }
    }
    sizes.append(count)
}
let keep = sizes.indices.max { sizes[$0] < sizes[$1] }!
var inside = [Bool](repeating: false, count: W * H)
for p in 0..<(W * H) where label[p] == keep { inside[p] = true }

// White die-cut border: dilate the drawing by a round brush.
let radius = 9 * scale
var offsets: [(Int, Int)] = []
for dy in -radius...radius { for dx in -radius...radius where dx * dx + dy * dy <= radius * radius { offsets.append((dx, dy)) } }
// Only edge pixels need stamping.
var border = [Bool](repeating: false, count: W * H)
for y in 1..<(H - 1) { for x in 1..<(W - 1) {
    let p = y * W + x
    guard inside[p], !(inside[p - 1] && inside[p + 1] && inside[p - W] && inside[p + W]) else { continue }
    for (dx, dy) in offsets {
        let nx = x + dx, ny = y + dy
        if nx >= 0, ny >= 0, nx < W, ny < H { border[ny * W + nx] = true }
    }
} }

// Compose: white border, then the drawing; everything else transparent.
let out = context(W, H)
let o = out.data!.bindMemory(to: UInt8.self, capacity: W * H * 4)
for p in 0..<(W * H) {
    let i = p * 4
    if inside[p] {
        // Drawing pixel over white: blend so semi-transparent edges sit on white, not on nothing.
        let a = Int(px[i + 3])
        o[i] = UInt8(Int(px[i]) + (255 - a)); o[i + 1] = UInt8(Int(px[i + 1]) + (255 - a))
        o[i + 2] = UInt8(Int(px[i + 2]) + (255 - a)); o[i + 3] = 255
    } else if border[p] || inside[p] {
        o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = 255
    }
}
let sticker = out.makeImage()!

func save(_ image: CGImage, _ path: String) {
    let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(d, image, nil)
    CGImageDestinationFinalize(d)
}

// Sticker at a sensible size (long side 600).
let f = 600.0 / Double(max(W, H))
let small = context(Int(Double(W) * f), Int(Double(H) * f))
small.interpolationQuality = .high
small.draw(sticker, in: CGRect(x: 0, y: 0, width: small.width, height: small.height))
save(small.makeImage()!, args[2])

// App icon: sky gradient, opaque, sticker centered with a soft shadow.
let side = 1024
let icon = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: rgb,
                     bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
let sky = CGGradient(colorsSpace: rgb, colors: [CGColor(red: 0.85, green: 0.96, blue: 1, alpha: 1),
                                                 CGColor(red: 0.50, green: 0.82, blue: 1, alpha: 1)] as CFArray, locations: [0, 1])!
icon.drawLinearGradient(sky, start: .zero, end: CGPoint(x: 0, y: side), options: [])
let g = 860.0 / Double(max(W, H))
let w = Double(W) * g, h = Double(H) * g
icon.interpolationQuality = .high
icon.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(red: 0.1, green: 0.2, blue: 0.4, alpha: 0.35))
icon.draw(sticker, in: CGRect(x: (Double(side) - w) / 2, y: (Double(side) - h) / 2, width: w, height: h))
save(icon.makeImage()!, args[3])
print("kept \(sizes[keep]) px of \(sizes.count) pieces; \(W)x\(H)")
