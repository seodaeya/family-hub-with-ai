// Apple Vision OCR CLI (macOS, on-device, no network)
// Usage: ocr <image-path> [langs]
// Output: JSON { width, height, blocks: [{ text, confidence, x, y, w, h }] }
import Foundation
import Vision
import AppKit

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
      let cgImage = bitmap.cgImage else {
    fail("cannot decode image: \(path)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = languages
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    fail("vision failed: \(error.localizedDescription)")
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
}

let observations = request.results ?? []
var blocks: [Block] = []

for observation in observations {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let box = observation.boundingBox
    blocks.append(Block(
        text: candidate.string,
        confidence: Double(candidate.confidence),
        x: Double(box.origin.x),
        y: Double(1.0 - box.origin.y - box.size.height), // flip to top-left origin
        w: Double(box.size.width),
        h: Double(box.size.height)
    ))
}

// Reading order: row by row (top to bottom), then left to right.
blocks.sort { a, b in
    let rowA = Int((a.y * 1000) / 24)
    let rowB = Int((b.y * 1000) / 24)
    if rowA != rowB { return rowA < rowB }
    return a.x < b.x
}

let output = Output(
    width: Double(cgImage.width),
    height: Double(cgImage.height),
    blocks: blocks
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
guard let data = try? encoder.encode(output) else {
    fail("encode failed")
}
FileHandle.standardOutput.write(data)
