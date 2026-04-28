import ApplicationServices
import CoreGraphics
import Foundation

// This helper exists because Electron's globalShortcut API is the wrong
// abstraction for a Wispr/Raycast-style dictation trigger. Electron
// accelerators are command shortcuts: they understand strings like
// Cmd+Shift+D, but they cannot reliably represent "bare Fn", "bare Cmd",
// layout-dependent punctuation, or modifier-only press transitions.
//
// macOS exposes those events through a lower-level CGEvent tap. Keeping
// this code first-party is intentional: the npm packages that wrap this
// layer hide exactly the behavior we need to understand when debugging
// keyboard edge cases. The protocol back to Electron is deliberately
// tiny JSON lines on stdout so the Electron app owns product state while
// this process owns only native keyboard observation.

let binding = CommandLine.arguments.dropFirst().joined(separator: " ")
let modifierNames: Set<String> = ["Cmd", "Ctrl", "Option", "Shift", "Fn"]
let parts = binding
  .split(separator: "+")
  .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
  .filter { !$0.isEmpty }

let requestedModifiers = Set(parts.filter { modifierNames.contains($0) })
let requestedKey = parts.last.flatMap { modifierNames.contains($0) ? nil : $0 }

// These names match the renderer's stored binding vocabulary, not the
// user's visible keyboard labels. That is on purpose: physical keycodes
// are stable enough for a dictation trigger, while glyphs on Swedish,
// US, and other layouts move around. If future UI wants "the character
// that appears on the key" instead, that should be a separate binding
// mode with a different source of truth.
let keyCodes: [String: CGKeyCode] = [
  "A": 0x00, "S": 0x01, "D": 0x02, "F": 0x03, "H": 0x04, "G": 0x05,
  "Z": 0x06, "X": 0x07, "C": 0x08, "V": 0x09, "B": 0x0B,
  "Q": 0x0C, "W": 0x0D, "E": 0x0E, "R": 0x0F, "Y": 0x10, "T": 0x11,
  "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16,
  "5": 0x17, "EQUALS": 0x18, "9": 0x19, "7": 0x1A, "MINUS": 0x1B,
  "8": 0x1C, "0": 0x1D, "SQUARE BRACKET OPEN": 0x1E, "O": 0x1F,
  "U": 0x20, "SQUARE BRACKET CLOSE": 0x21, "I": 0x22, "P": 0x23,
  "RETURN": 0x24, "L": 0x25, "J": 0x26, "QUOTE": 0x27, "K": 0x28,
  "SEMICOLON": 0x29, "BACKSLASH": 0x2A, "COMMA": 0x2B,
  "FORWARD SLASH": 0x2C, "N": 0x2D, "M": 0x2E, "DOT": 0x2F,
  "TAB": 0x30, "SPACE": 0x31, "BACKTICK": 0x32, "BACKSPACE": 0x33,
  "ESCAPE": 0x35, "DELETE": 0x75, "HOME": 0x73, "END": 0x77,
  "PAGE UP": 0x74, "PAGE DOWN": 0x79, "LEFT ARROW": 0x7B,
  "RIGHT ARROW": 0x7C, "DOWN ARROW": 0x7D, "UP ARROW": 0x7E,
  "F1": 0x7A, "F2": 0x78, "F3": 0x63, "F4": 0x76, "F5": 0x60,
  "F6": 0x61, "F7": 0x62, "F8": 0x64, "F9": 0x65, "F10": 0x6D,
  "F11": 0x67, "F12": 0x6F, "F13": 0x69, "F14": 0x6B, "F15": 0x71,
  "F16": 0x6A, "F17": 0x40, "F18": 0x4F, "F19": 0x50, "F20": 0x5A
]

let requestedKeyCode = requestedKey.flatMap { keyCodes[$0] }
var previousModifierMatch = false
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

func emit(_ type: String, _ extra: String = "") {
  let suffix = extra.isEmpty ? "" : ",\(extra)"
  print("{\"type\":\"\(type)\",\"binding\":\"\(binding)\"\(suffix)}")
  fflush(stdout)
}

func shouldFireKeyDown(_ event: CGEvent) -> Bool {
  guard let keyCode = requestedKeyCode else { return false }
  if event.getIntegerValueField(.keyboardEventKeycode) != Int64(keyCode) { return false }
  return activeModifiers(event.flags) == requestedModifiers
}

func shouldFireModifierTransition(_ event: CGEvent) -> Bool {
  if requestedKey != nil { return false }
  let isMatch = activeModifiers(event.flags) == requestedModifiers
  defer { previousModifierMatch = isMatch }
  return isMatch && !previousModifierMatch
}

if binding.isEmpty {
  fputs("[agent-voice-hotkey-helper] empty binding\n", stderr)
  exit(64)
}

if requestedKey != nil && requestedKeyCode == nil {
  fputs("[agent-voice-hotkey-helper] unsupported key in binding: \(binding)\n", stderr)
  exit(65)
}

let promptOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(promptOptions) {
  fputs("[agent-voice-hotkey-helper] accessibility permission is required\n", stderr)
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let eventTap {
      CGEvent.tapEnable(tap: eventTap, enable: true)
      emit("tap-reenabled")
    }
    return Unmanaged.passUnretained(event)
  }

  if type == .keyDown && shouldFireKeyDown(event) {
    emit("hotkey")
    return nil
  }

  if type == .flagsChanged && shouldFireModifierTransition(event) {
    emit("hotkey")
    return nil
  }

  return Unmanaged.passUnretained(event)
}

let mask = CGEventMask(
  (1 << CGEventType.keyDown.rawValue) |
  (1 << CGEventType.flagsChanged.rawValue)
)

guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: mask,
  callback: callback,
  userInfo: nil
) else {
  fputs("[agent-voice-hotkey-helper] failed to create event tap\n", stderr)
  exit(66)
}

eventTap = tap
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit("ready")
CFRunLoopRun()
