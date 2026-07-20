import AppKit
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("packaged icon render check failed: \(message)\n".utf8))
  exit(1)
}

guard CommandLine.arguments.count == 2 else {
  fail("usage: swift scripts/check-packaged-icon-render.swift <DocPilot.app>")
}

let appPath = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL.path
guard let bundle = Bundle(path: appPath) else {
  fail("unable to load app bundle at \(appPath)")
}

guard bundle.object(forInfoDictionaryKey: "CFBundleIconName") as? String == "Icon" else {
  fail("CFBundleIconName must be Icon so macOS uses the Icon Composer asset catalog")
}

let assetsCatalog = URL(fileURLWithPath: appPath)
  .appendingPathComponent("Contents/Resources/Assets.car").path
guard FileManager.default.fileExists(atPath: assetsCatalog) else {
  fail("Assets.car is missing")
}

let image = NSWorkspace.shared.icon(forFile: appPath)
image.size = NSSize(width: 256, height: 256)
guard
  let tiff = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff)
else {
  fail("unable to render NSWorkspace icon")
}

let width = bitmap.pixelsWide
let height = bitmap.pixelsHigh
let samplePoints = [
  (Int(Double(width) * 0.15), Int(Double(height) * 0.50)),
  (Int(Double(width) * 0.85), Int(Double(height) * 0.50)),
  (Int(Double(width) * 0.50), Int(Double(height) * 0.15)),
  (Int(Double(width) * 0.50), Int(Double(height) * 0.85)),
]

let luminances = samplePoints.compactMap { x, y -> Double? in
  guard
    let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
    color.alphaComponent > 0.5
  else {
    return nil
  }
  return 0.2126 * color.redComponent
    + 0.7152 * color.greenComponent
    + 0.0722 * color.blueComponent
}

guard luminances.count == samplePoints.count else {
  fail("outer enclosure samples must be opaque in the native icon")
}

let averageOuterLuminance = luminances.reduce(0, +) / Double(luminances.count)
guard averageOuterLuminance < 0.35 else {
  fail(String(format: "native outer enclosure is too bright (average luminance %.3f)", averageOuterLuminance))
}

print(String(format: "packaged native icon render passed (outer luminance %.3f)", averageOuterLuminance))
