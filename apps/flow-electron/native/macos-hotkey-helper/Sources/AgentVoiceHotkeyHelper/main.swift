import ApplicationServices
import AppKit
import CoreGraphics
import Foundation

// Electron owns settings and recording; this helper owns native event matching.
// argv[3] is an optional second binding so old keyboard-only invocations remain valid.
let binding = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let yieldConfigJson = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "{}"
let mouseBinding = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : ""
let yieldConfig = (try? JSONDecoder().decode(YieldConfig.self, from: Data(yieldConfigJson.utf8)))
  ?? YieldConfig(frontmostBundleIds: [], frontmostAppNames: [])

// The main process uses the exact same native focus policy immediately before
// auto-paste. This mode never installs an event tap or prompts for permissions.
if binding == "--query-yield" {
  print(shouldYieldForTextFocus(yieldConfig, forPaste: true) ? "true" : "false")
  exit(0)
}
let definitions: [BindingDefinition]
do {
  definitions = try ([binding] + (mouseBinding.isEmpty ? [] : [mouseBinding])).map(BindingDefinition.init)
} catch {
  fputs("[agent-voice-hotkey-helper] \(error.localizedDescription)\n", stderr)
  exit(65)
}
var state = BindingState(bindings: definitions)
var eventTap: CFMachPort?

func activeModifiers(_ flags: CGEventFlags) -> Set<String> {
  var result = Set<String>()
  if flags.contains(.maskCommand) { result.insert("Cmd") }
  if flags.contains(.maskControl) { result.insert("Ctrl") }
  if flags.contains(.maskAlternate) { result.insert("Option") }
  if flags.contains(.maskShift) { result.insert("Shift") }
  if flags.contains(.maskSecondaryFn) { result.insert("Fn") }
  return result
}

func shouldYieldToFrontmostApp() -> Bool {
  // Decide before consuming the event or waking the pill. Frontmost identity
  // alone is insufficient: an Agent Code sidebar/window may be active while
  // the user is not typing in its editor.
  return shouldYieldForTextFocus(yieldConfig)
}

func emit(_ type: String) {
  // Serialize rather than interpolate arbitrary stored settings into JSON.
  let payload = ["type": type, "binding": binding]
  if let data = try? JSONSerialization.data(withJSONObject: payload),
     let json = String(data: data, encoding: .utf8) {
    print(json)
    fflush(stdout)
  }
}

let promptOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(promptOptions) {
  emit("permission-required")
  fputs("[agent-voice-hotkey-helper] accessibility permission is required\n", stderr)
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    // Missing a release while the tap is disabled must never leave recording on.
    if state.reset() { emit("hotkey-up") }
    if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
    emit("tap-reenabled")
    return Unmanaged.passUnretained(event)
  }
  let input = BindingInput(type: type,
    keyCode: event.getIntegerValueField(.keyboardEventKeycode),
    mouseButton: event.getIntegerValueField(.mouseEventButtonNumber),
    modifiers: activeModifiers(event.flags),
    isRepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
  let result = state.handle(input, shouldYield: shouldYieldToFrontmostApp)
  if let transition = result.transition { emit(transition) }
  return result.consume ? nil : Unmanaged.passUnretained(event)
}

let eventTypes: [CGEventType] = [.keyDown, .keyUp, .flagsChanged,
  .otherMouseDown, .otherMouseUp, .otherMouseDragged]
let mask = eventTypes.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
  options: .defaultTap, eventsOfInterest: mask, callback: callback, userInfo: nil) else {
  fputs("[agent-voice-hotkey-helper] failed to create event tap\n", stderr)
  exit(66)
}
eventTap = tap
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit("ready")
CFRunLoopRun()
