import CoreGraphics
import Foundation

let modifierNames: Set<String> = ["Cmd", "Ctrl", "Option", "Shift", "Fn"]
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
  // BRACKET_LEFT (`[`) is kVK_ANSI_LeftBracket = 0x21 and BRACKET_RIGHT
  // (`]`) is kVK_ANSI_RightBracket = 0x1E. Earlier versions of this table
  // labeled them as OPEN/CLOSE and swapped them; the renderer happened to
  // emit the swapped names, so the round-trip worked anyway. Names now
  // follow physical key position to match the renderer vocabulary.
  "8": 0x1C, "0": 0x1D, "BRACKET_RIGHT": 0x1E, "O": 0x1F,
  "U": 0x20, "BRACKET_LEFT": 0x21, "I": 0x22, "P": 0x23,
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


struct BindingDefinition {
  let modifiers: Set<String>
  let keyCode: Int64?
  let mouseButton: Int64?
  var isModifierOnly: Bool { keyCode == nil && mouseButton == nil }

  init(_ value: String) throws {
    let parts = value.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
    let mods = parts.filter { modifierNames.contains($0) }
    modifiers = Set(mods)
    let trigger = parts.last.flatMap { modifierNames.contains($0) ? nil : $0 }
    keyCode = trigger.flatMap { keyCodes[$0].map(Int64.init) }
    mouseButton = trigger.flatMap { token in
      if token == "MOUSE_MIDDLE" { return Int64(2) }
      if token.hasPrefix("MOUSE_"), let number = Int64(token.dropFirst(6)), (4...32).contains(number) {
        return number - 1
      }
      return nil
    }
    guard !value.isEmpty, Set(parts).count == parts.count,
          mods.count + (trigger == nil ? 0 : 1) == parts.count,
          trigger == nil || keyCode != nil || mouseButton != nil else {
      throw NSError(domain: "AgentVoiceBinding", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Unsupported binding: \(value)"])
    }
  }
}

struct BindingInput {
  let type: CGEventType
  var keyCode: Int64 = -1
  var mouseButton: Int64 = -1
  var modifiers: Set<String> = []
  var isRepeat: Bool = false
}

struct BindingResult {
  var consume = false
  var transition: String? = nil
}

// A single owner set joins keyboard and mouse into one hold-to-talk gesture.
// Releasing one trigger while another is still held must not finalize speech.
// Down ownership also governs drag/up consumption after modifiers or focus change;
// otherwise the target app receives an orphan release or accidental middle drag.
struct BindingState {
  let bindings: [BindingDefinition]
  private var active: Set<Int> = []
  init(bindings: [BindingDefinition]) { self.bindings = bindings }

  mutating func reset() -> Bool {
    let wasActive = !active.isEmpty
    active.removeAll()
    return wasActive
  }

  mutating func handle(_ input: BindingInput, shouldYield: () -> Bool = { false }) -> BindingResult {
    let wasActive = !active.isEmpty
    var result = BindingResult()
    for (index, binding) in bindings.enumerated() {
      var press = false
      var release = false
      let owned = active.contains(index)
      if let button = binding.mouseButton {
        if input.mouseButton == button {
          press = input.type == .otherMouseDown && input.modifiers == binding.modifiers
          release = input.type == .otherMouseUp
          if owned && [.otherMouseDown, .otherMouseDragged, .otherMouseUp].contains(input.type) {
            result.consume = true
          }
        }
      } else if let key = binding.keyCode {
        if input.keyCode == key {
          press = input.type == .keyDown && !input.isRepeat && input.modifiers == binding.modifiers
          release = input.type == .keyUp
          if owned && (input.type == .keyDown || input.type == .keyUp) { result.consume = true }
        }
      } else if input.type == .flagsChanged {
        press = input.modifiers == binding.modifiers
        release = !press
        if owned { result.consume = true }
      }
      if release && owned { active.remove(index) }
      if press && !owned && !shouldYield() {
        active.insert(index)
        result.consume = true
      }
    }
    if !wasActive && !active.isEmpty { result.transition = "hotkey-down" }
    if wasActive && active.isEmpty { result.transition = "hotkey-up" }
    return result
  }
}
