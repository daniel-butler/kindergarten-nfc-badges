import CoreImage
import UIKit
import Vision

/// Lifts the sticker off the cardstock (like long-pressing a photo to lift its subject),
/// then tidies its edges with `StickerEdges`.
enum StickerCutout {
    static let maxSide: CGFloat = 600

    static func lift(_ photo: UIImage) async -> (image: UIImage, lifted: Bool) {
        await Task.detached(priority: .userInitiated) { liftSync(photo) }.value
    }

    private static func liftSync(_ photo: UIImage) -> (image: UIImage, lifted: Bool) {
        let upright = redraw(photo, size: photo.size, opaque: false)
        guard let cg = upright.cgImage else { return (centerSquare(upright), false) }
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cg)
        do {
            try handler.perform([request])
            guard let result = request.results?.first, !result.allInstances.isEmpty else {
                return (centerSquare(upright), false)
            }
            let buffer = try result.generateMaskedImage(
                ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
            let ci = CIImage(cvPixelBuffer: buffer)
            guard let out = CIContext().createCGImage(ci, from: ci.extent) else {
                return (centerSquare(upright), false)
            }
            let lifted = scaledToFit(UIImage(cgImage: out))
            // Tidy the edges; if the sticker has no dark outline, keep Vision's cutout as is.
            if let cg = lifted.cgImage, let cleaned = StickerEdges.clean(cg) {
                return (UIImage(cgImage: cleaned), true)
            }
            return (lifted, true)
        } catch {
            return (centerSquare(upright), false)
        }
    }

    /// Used when Vision finds no subject: the middle of the photo, square.
    private static func centerSquare(_ image: UIImage) -> UIImage {
        let side = min(image.size.width, image.size.height)
        let origin = CGPoint(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let square = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(at: CGPoint(x: -origin.x, y: -origin.y))
        }
        return scaledToFit(square)
    }

    private static func scaledToFit(_ image: UIImage) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        let factor = min(1, maxSide / longest)
        return redraw(image, size: CGSize(width: image.size.width * factor, height: image.size.height * factor), opaque: false)
    }

    /// Redraws at scale 1, which also applies the photo's orientation.
    private static func redraw(_ image: UIImage, size: CGSize, opaque: Bool) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
