// Runs the same cutout + edge cleanup as Zoo Tap, on a Mac:
//   swiftc -O Tools/clean-sticker/main.swift ClassroomZoo/StickerEdges.swift -o /tmp/clean-sticker
//   /tmp/clean-sticker <photo-or-cutout> <out-sticker.png> [<out-app-icon.png>]
// A photo without transparency is lifted with Vision first, like the phone does.
// Regenerate the app art:  /tmp/clean-sticker Tools/puppy-source.png \
//   ClassroomZoo/Assets.xcassets/Puppy.imageset/Puppy.png ClassroomZoo/Assets.xcassets/AppIcon.appiconset/AppIcon.png
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let args = CommandLine.arguments
guard args.count >= 3,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      var image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    print("usage: clean-sticker <in> <out-sticker.png> [<out-app-icon.png>]")
    exit(2)
}
let rgb = CGColorSpaceCreateDeviceRGB()

func resized(_ img: CGImage, longSide: Double, opaque: Bool = false) -> CGImage {
    let f = longSide / Double(max(img.width, img.height))
    let w = Int(Double(img.width) * f), h = Int(Double(img.height) * f)
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: rgb,
                        bitmapInfo: (opaque ? CGImageAlphaInfo.noneSkipLast : .premultipliedLast).rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}

func save(_ img: CGImage, _ path: String) {
    let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(d, img, nil)
    CGImageDestinationFinalize(d)
}

let hasAlpha = ![.none, .noneSkipLast, .noneSkipFirst].contains(image.alphaInfo)
if !hasAlpha {
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: image)
    try handler.perform([request])
    guard let result = request.results?.first, !result.allInstances.isEmpty else {
        print("Vision found no sticker in the photo")
        exit(1)
    }
    let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
    let ci = CIImage(cvPixelBuffer: buffer)
    image = CIContext().createCGImage(ci, from: ci.extent)!
}

// Clean at a generous size so the new border is smooth, then shrink like the phone does.
let working = resized(image, longSide: 1200)
let cleaned = StickerEdges.clean(working)
if cleaned == nil { print("no dark outline found: keeping the plain cutout") }
let sticker = cleaned ?? working
save(resized(sticker, longSide: 600), args[2])

if args.count >= 4 {
    let side = 1024
    let icon = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: rgb,
                         bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    let sky = CGGradient(colorsSpace: rgb, colors: [CGColor(red: 0.85, green: 0.96, blue: 1, alpha: 1),
                                                     CGColor(red: 0.50, green: 0.82, blue: 1, alpha: 1)] as CFArray,
                         locations: [0, 1])!
    icon.drawLinearGradient(sky, start: .zero, end: CGPoint(x: 0, y: side), options: [])
    let f = 860.0 / Double(max(sticker.width, sticker.height))
    let w = Double(sticker.width) * f, h = Double(sticker.height) * f
    icon.interpolationQuality = .high
    icon.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(red: 0.1, green: 0.2, blue: 0.4, alpha: 0.35))
    icon.draw(sticker, in: CGRect(x: (Double(side) - w) / 2, y: (Double(side) - h) / 2, width: w, height: h))
    save(icon.makeImage()!, args[3])
}
