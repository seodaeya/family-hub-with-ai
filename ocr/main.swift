// Apple Vision OCR CLI (macOS, on-device, no network)
// Usage: ocr <image-path> [langs]
// Output: JSON { width, height, blocks: [{ text, confidence, x, y, w, h }], meanConfidence, deskewed }
//
// Two passes: the photo as-is, and a perspective-corrected version when the
// page edges can be detected. Whichever reads more text wins. Phone photos of a
// notice lying on a desk are usually tilted, and correcting the perspective is
// the single biggest accuracy win for that case.
import Foundation
import Vision
import AppKit
import CoreImage

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("usage: ocr <image-path> [ko-KR,en-US]")
}

let path = args[1]
let languages: [String] = args.count >= 3
    ? args[2].split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    : ["ko-KR", "en-US"]

guard let image = NSImage(contentsOfFile: path) else {
    fail("cannot load image: \(path)")
}

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let sourceImage = bitmap.cgImage else {
    fail("cannot decode image: \(path)")
}

// ---------------------------------------------------------------- recognition

typealias RawBlock = (text: String, confidence: Float, box: CGRect)

struct Pass {
    let blocks: [RawBlock]
    let width: Int
    let height: Int
    let deskewed: Bool

    var characters: Int { blocks.reduce(0) { $0 + $1.text.count } }
    var meanConfidence: Double {
        guard !blocks.isEmpty else { return 0 }
        return Double(blocks.reduce(Float(0)) { $0 + $1.confidence }) / Double(blocks.count)
    }
    var score: Double { Double(characters) + meanConfidence * 120 }
}

func recognize(_ cgImage: CGImage, languages: [String]) -> [RawBlock] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = languages
    // Korean notices mix 한글, English and numbers; auto-detect avoids forcing
    // the wrong language model onto an English-only header.
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return []
    }

    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate.string, candidate.confidence, observation.boundingBox)
    }
}

/// Detects the sheet of paper and flattens it. Returns nil when no page is found.
func perspectiveCorrected(_ cgImage: CGImage) -> CGImage? {
    let detect = VNDetectRectanglesRequest()
    detect.maximumObservations = 1
    detect.minimumConfidence = 0.4
    detect.minimumSize = 0.25
    detect.minimumAspectRatio = 0.2
    detect.quadratureTolerance = 30

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    guard (try? handler.perform([detect])) != nil,
          let rectangle = detect.results?.first else { return nil }

    let width = CGFloat(cgImage.width)
    let height = CGFloat(cgImage.height)
    // Vision points are normalised with a bottom-left origin, same as Core Image.
    let topLeft = CGPoint(x: rectangle.topLeft.x * width, y: rectangle.topLeft.y * height)
    let topRight = CGPoint(x: rectangle.topRight.x * width, y: rectangle.topRight.y * height)
    let bottomLeft = CGPoint(x: rectangle.bottomLeft.x * width, y: rectangle.bottomLeft.y * height)
    let bottomRight = CGPoint(x: rectangle.bottomRight.x * width, y: rectangle.bottomRight.y * height)

    // A page filling the frame needs no correction and would only lose edges.
    let area = abs((topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y))
    if area < 0.25 * width * height { return nil }

    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
    filter.setValue(CIImage(cgImage: cgImage), forKey: kCIInputImageKey)
    filter.setValue(CIVector(cgPoint: topLeft), forKey: "inputTopLeft")
    filter.setValue(CIVector(cgPoint: topRight), forKey: "inputTopRight")
    filter.setValue(CIVector(cgPoint: bottomLeft), forKey: "inputBottomLeft")
    filter.setValue(CIVector(cgPoint: bottomRight), forKey: "inputBottomRight")

    guard let output = filter.outputImage else { return nil }
    let context = CIContext(options: [.useSoftwareRenderer: false])
    return context.createCGImage(output, from: output.extent)
}

let plain = Pass(
    blocks: recognize(sourceImage, languages: languages),
    width: sourceImage.width,
    height: sourceImage.height,
    deskewed: false
)

var best = plain
if let corrected = perspectiveCorrected(sourceImage) {
    let pass = Pass(
        blocks: recognize(corrected, languages: languages),
        width: corrected.width,
        height: corrected.height,
        deskewed: true
    )
    if pass.score > plain.score * 1.02 {
        best = pass
    }
}

// ------------------------------------------------------------------- layout

/// Groups blocks that sit on the same visual line and joins them, keeping
/// table columns on one line ("09:30 ~ 12:10  |  레이저서바이벌 …").
func mergeLines(_ blocks: [RawBlock]) -> [RawBlock] {
    let sorted = blocks.sorted { a, b in
        let ay = 1 - a.box.midY
        let by = 1 - b.box.midY
        if abs(ay - by) > 0.008 { return ay < by }
        return a.box.minX < b.box.minX
    }

    var lines: [[RawBlock]] = []
    for block in sorted {
        let center = 1 - block.box.midY
        let tolerance = max(0.006, block.box.height * 0.5)
        if let index = lines.lastIndex(where: { line in
            guard let first = line.first else { return false }
            return abs((1 - first.box.midY) - center) <= max(tolerance, first.box.height * 0.5)
        }) {
            lines[index].append(block)
        } else {
            lines.append([block])
        }
    }

    return lines.map { line in
        let ordered = line.sorted { $0.box.minX < $1.box.minX }
        var text = ""
        var previousEnd: CGFloat?
        for block in ordered {
            if let end = previousEnd {
                let gap = block.box.minX - end
                text += gap > 0.025 ? "  |  " : " "
            }
            text += block.text
            previousEnd = block.box.maxX
        }
        let box = ordered.dropFirst().reduce(ordered[0].box) { $0.union($1.box) }
        let confidence = ordered.map(\.confidence).min() ?? 0
        return (text, confidence, box)
    }
}

struct Block: Codable {
    let text: String
    let confidence: Double
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct Output: Codable {
    let width: Double
    let height: Double
    let blocks: [Block]
    let meanConfidence: Double
    let deskewed: Bool
}

let merged = mergeLines(best.blocks)
var blocks: [Block] = []

for block in merged {
    let box = block.box
    blocks.append(Block(
        text: block.text,
        confidence: Double(block.confidence),
        x: Double(box.origin.x),
        y: Double(1.0 - box.origin.y - box.size.height), // flip to top-left origin
        w: Double(box.size.width),
        h: Double(box.size.height)
    ))
}

// Reading order: top to bottom, then left to right. mergeLines already did the
// row grouping, so this only fixes up rows that ended up out of order.
blocks.sort { a, b in
    let rowA = Int((a.y * 1000) / 24)
    let rowB = Int((b.y * 1000) / 24)
    if rowA != rowB { return rowA < rowB }
    return a.x < b.x
}

let output = Output(
    width: Double(best.width),
    height: Double(best.height),
    blocks: blocks,
    meanConfidence: Double(round(best.meanConfidence * 1000) / 1000),
    deskewed: best.deskewed
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
guard let data = try? encoder.encode(output) else {
    fail("encode failed")
}
FileHandle.standardOutput.write(data)
