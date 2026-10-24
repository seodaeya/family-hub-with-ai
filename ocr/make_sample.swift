// Test fixture generator: renders a Korean notice into a PNG.
// Usage: swift make_sample.swift <out.png>
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "sample.png"
let size = NSSize(width: 1000, height: 760)

let image = NSImage(size: size)
image.lockFocus()

NSColor.white.setFill()
NSRect(origin: .zero, size: size).fill()

let paragraphs: [(String, CGFloat, Bool)] = [
    ("2026학년도 2학기 현장학습 안내", 34, true),
    ("", 12, false),
    ("학부모님께", 18, true),
    ("안녕하세요. 3학년 2반 담임입니다.", 20, false),
    ("다음 주 금요일 현장학습 일정을 안내드립니다.", 20, false),
    ("", 12, false),
    ("* 일시: 10월 30일(금) 오전 8시 40분 출발", 22, false),
    ("* 장소: 국립과천과학관", 22, false),
    ("* 준비물: 도시락, 물통, 필기도구, 모자", 22, false),
    ("* 회비: 15,000원 (10월 27일까지 제출)", 22, false),
    ("* 귀가: 오후 4시 30분 학교 정문", 22, false),
    ("", 12, false),
    ("가정통신문 확인 후 서명 부탁드립니다.", 20, false),
    ("문의: 02-1234-5678", 18, false),
]

var y: CGFloat = size.height - 70
for (text, fontSize, bold) in paragraphs {
    let font = bold
        ? NSFont.boldSystemFont(ofSize: fontSize)
        : NSFont.systemFont(ofSize: fontSize)
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.black,
    ]
    let str = NSAttributedString(string: text, attributes: attrs)
    str.draw(at: NSPoint(x: 60, y: y - fontSize))
    y -= fontSize + 14
}

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("render failed")
}
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
