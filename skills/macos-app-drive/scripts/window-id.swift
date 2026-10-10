// Print on-screen windows for an app so one can be captured with
// `screencapture -x -l <id> out.png`.
// Usage: swift window-id.swift <owner name> [title substring]
// Output: id<TAB>title<TAB>x,y wxh  (largest window first)
// Titles are empty unless the calling terminal has Screen Recording permission.
import CoreGraphics
import Foundation

let args = CommandLine.arguments.dropFirst()
guard let owner = args.first else {
  print("usage: swift window-id.swift <owner name> [title substring]")
  exit(2)
}
let titleFilter = args.dropFirst().first ?? ""
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []

let rows = info.compactMap { w -> (Int, String, CGRect)? in
  guard (w[kCGWindowOwnerName as String] as? String) == owner,
        (w[kCGWindowLayer as String] as? Int) == 0,
        let id = w[kCGWindowNumber as String] as? Int,
        let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { return nil }
  let title = w[kCGWindowName as String] as? String ?? ""
  if !titleFilter.isEmpty && !title.contains(titleFilter) { return nil }
  return (id, title, CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0))
}.sorted { $0.2.width * $0.2.height > $1.2.width * $1.2.height }

if rows.isEmpty {
  print("error: no on-screen window for \"\(owner)\". Check the owner name with: osascript -e 'tell application \"System Events\" to get name of every process whose background only is false'")
  exit(1)
}
for (id, title, r) in rows { print("\(id)\t\(title)\t\(Int(r.minX)),\(Int(r.minY)) \(Int(r.width))x\(Int(r.height))") }
