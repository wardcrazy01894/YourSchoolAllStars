// Re-OCR a single scanned page with macOS Vision, emitting one word per line as
//     x1,y1,x2,y2<TAB>text
// in pixel coordinates — the same shape parse-guides.mjs already reads out of the
// Internet Archive's djvu.xml.
//
// Usage:  swift data-work/unc/ocr-page.swift <image.jpg>
//
// WHY: the IA scans carry ABBYY OCR of wildly varying quality, and for the 1996
// table it simply FAILED on the bottom half of the page — the numeric cells for 18
// players (and the "UNC Totals" row that verifies the whole table) were never
// recognised at all, so no parser could recover them. That is an OCR problem, not
// a parsing one, and the fix is a better OCR of the same page, not a cleverer
// guess. Vision reads that page cleanly. Everything downstream — the geometric
// column alignment, the T+A=Hit row checksum, the team-total reconciliation, the
// Sports-Reference cross-check — is unchanged and still has to pass.
//
// `accurate` recognition, language correction OFF (it "corrects" digits otherwise),
// and a custom word list of the header tokens so the column names survive.

import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("usage: ocr-page.swift <image>\n".data(using: .utf8)!)
    exit(1)
}

let W = Double(cg.width)
let H = Double(cg.height)

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
request.customWords = ["G-GS", "TFL-Yds", "QB-Yds", "RF-Yds", "FR-Yds", "DP-PBU",
                       "PBU", "Pres", "Int", "Hit", "HITS", "SACKS", "TFL-YDS"]

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([request])

var out = ""
for obs in (request.results ?? []) {
    guard let cand = obs.topCandidates(1).first else { continue }
    let text = cand.string
    // Split the recognised line into words and recover each word's own box, so the
    // output is word-level geometry (what the column alignment needs) rather than
    // whole lines.
    var idx = text.startIndex
    for word in text.split(separator: " ") {
        guard let r = text.range(of: String(word), range: idx..<text.endIndex) else { continue }
        idx = r.upperBound
        guard let box = try? cand.boundingBox(for: r)?.boundingBox else { continue }
        // Vision's origin is bottom-left and normalised; the parser wants top-left pixels.
        let x1 = box.minX * W
        let x2 = box.maxX * W
        let y1 = (1 - box.maxY) * H
        let y2 = (1 - box.minY) * H
        out += "\(Int(x1)),\(Int(y1)),\(Int(x2)),\(Int(y2))\t\(word)\n"
    }
}
FileHandle.standardOutput.write(out.data(using: .utf8)!)
