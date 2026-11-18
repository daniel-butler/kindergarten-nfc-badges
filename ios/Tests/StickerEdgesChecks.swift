import CoreGraphics
import Foundation

// Synthetic 200×200 sticker cutout: old white border ring (r≤70), dark outline (60–64),
// tan fill inside with a white highlight at the center, and a stray speck in the corner.
private let size = 200

private func makeImage(_ pixel: (Int, Int) -> (UInt8, UInt8, UInt8, UInt8)) -> CGImage {
    var bytes = [UInt8](repeating: 0, count: size * size * 4)
    for y in 0..<size { for x in 0..<size {
        let (r, g, b, a) = pixel(x, y)
        let i = (y * size + x) * 4
        // premultiplied RGBA
        bytes[i] = UInt8(Int(r) * Int(a) / 255); bytes[i + 1] = UInt8(Int(g) * Int(a) / 255)
        bytes[i + 2] = UInt8(Int(b) * Int(a) / 255); bytes[i + 3] = a
    } }
    let provider = CGDataProvider(data: Data(bytes) as CFData)!
    return CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
                   space: CGColorSpaceCreateDeviceRGB(),
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
}

private func pixels(_ image: CGImage) -> [UInt8] {
    let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
                        bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let p = ctx.data!.bindMemory(to: UInt8.self, capacity: image.width * image.height * 4)
    return Array(UnsafeBufferPointer(start: p, count: image.width * image.height * 4))
}

func runStickerEdgesChecks() {
    let outlined = makeImage { x, y in
        let d = hypot(Double(x - 100), Double(y - 100))
        if x >= 8 && x <= 11 && y >= 8 && y <= 11 { return (230, 190, 130, 255) } // stray speck
        if d < 10 { return (255, 255, 255, 255) }   // highlight inside the drawing
        if d < 60 { return (230, 190, 130, 255) }   // tan body
        if d <= 64 { return (20, 20, 20, 255) }     // dark outline
        if d <= 70 { return (250, 250, 250, 255) }  // ragged leftover of the old white border
        return (0, 0, 0, 0)
    }
    guard let cleaned = StickerEdges.clean(outlined) else {
        check(false, "clean() refused an outlined sticker")
        return
    }
    let pad = StickerEdges.padding(forWidth: size, height: size)
    check(cleaned.width == size + 2 * pad && cleaned.height == size + 2 * pad, "clean() adds room for the border")
    let px = pixels(cleaned)
    // Coordinates below are in the original image; the output is shifted by `pad`.
    func at(_ x: Int, _ y: Int) -> (r: Int, g: Int, b: Int, a: Int) {
        let i = ((y + pad) * cleaned.width + x + pad) * 4
        return (Int(px[i]), Int(px[i + 1]), Int(px[i + 2]), Int(px[i + 3]))
    }
    check(at(100, 100) == (255, 255, 255, 255), "white highlight inside the outline is kept")
    check(at(100, 130).a == 255 && at(100, 130).b < 160, "tan body is kept")
    check(at(100, 162).a == 255 && at(100, 162).r < 60, "dark outline is kept")
    let border = StickerEdges.borderRadius(forWidth: size, height: size)
    check(at(100 + 64 + border / 2, 100) == (255, 255, 255, 255), "new white border right outside the outline")
    check(at(100 + 64 + border + 2, 100).a == 0, "old fringe beyond the new border is gone")
    check(at(9, 9).a == 0, "stray speck is gone")

    // A drawing cropped tight to the image edge still gets its full border.
    let tight = makeImage { x, y in
        let d = hypot(Double(x - 100), Double(y - 100))
        if d < 96 { return (230, 190, 130, 255) }
        if d <= 100 { return (20, 20, 20, 255) }
        return (0, 0, 0, 0)
    }
    if let t = StickerEdges.clean(tight) {
        let tp = pixels(t)
        let i = ((pad + 100) * t.width + pad + 200 + border / 2) * 4 // just right of the drawing's right edge
        check(tp[i + 3] == 255 && tp[i] == 255, "border isn't cut off when the drawing touches the edge")
    } else {
        check(false, "clean() refused a tightly cropped sticker")
    }

    let noOutline = makeImage { x, y in
        hypot(Double(x - 100), Double(y - 100)) < 60 ? (248, 248, 248, 255) : (0, 0, 0, 0)
    }
    check(StickerEdges.clean(noOutline) == nil, "a sticker with no dark outline is left alone (nil)")
}
