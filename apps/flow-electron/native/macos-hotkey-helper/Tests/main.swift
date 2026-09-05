import CoreGraphics
import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() { fatalError(message) }
}
func state(_ bindings: String...) -> BindingState {
  return BindingState(bindings: bindings.map { try! BindingDefinition($0) })
}
var middle = state("MOUSE_MIDDLE")
check(!middle.handle(BindingInput(type: .leftMouseDown, mouseButton: 0)).consume, "left click must pass")
check(!middle.handle(BindingInput(type: .rightMouseDown, mouseButton: 1)).consume, "right click must pass")
check(!middle.handle(BindingInput(type: .otherMouseDragged, mouseButton: 2)).consume, "unowned drag must pass")
check(middle.handle(BindingInput(type: .otherMouseDown, mouseButton: 2)).transition == "hotkey-down", "middle starts")
check(middle.handle(BindingInput(type: .otherMouseDragged, mouseButton: 2)).consume, "owned drag consumed")
check(middle.handle(BindingInput(type: .otherMouseDown, mouseButton: 2)).transition == nil, "duplicate down suppressed")
check(middle.handle(BindingInput(type: .otherMouseUp, mouseButton: 3)).transition == nil, "other button cannot release")
let released = middle.handle(BindingInput(type: .otherMouseUp, mouseButton: 2))
check(released.consume && released.transition == "hotkey-up", "middle release pairs with owned down")

var chord = state("Shift+MOUSE_MIDDLE")
check(!chord.handle(BindingInput(type: .otherMouseDown, mouseButton: 2)).consume, "modifier required")
check(!chord.handle(BindingInput(type: .otherMouseDown, mouseButton: 2, modifiers: ["Shift", "Cmd"])).consume, "modifiers exact")
check(chord.handle(BindingInput(type: .otherMouseDown, mouseButton: 2, modifiers: ["Shift"])).transition == "hotkey-down", "chord starts")
check(chord.handle(BindingInput(type: .flagsChanged)).transition == nil, "modifier release doesn't orphan held mouse")
check(chord.handle(BindingInput(type: .otherMouseUp, mouseButton: 2)).transition == "hotkey-up", "release after modifier change")

// Test both release orders: neither source may stop the other source's gesture.
for keyboardFirst in [true, false] {
  var both = state("F8", "MOUSE_MIDDLE")
  check(both.handle(BindingInput(type: .keyDown, keyCode: 0x64)).transition == "hotkey-down", "keyboard starts")
  check(both.handle(BindingInput(type: .keyDown, keyCode: 0x64, isRepeat: true)).consume, "owned repeat consumed")
  check(both.handle(BindingInput(type: .otherMouseDown, mouseButton: 2)).transition == nil, "overlap doesn't start twice")
  let keyUp = BindingInput(type: .keyUp, keyCode: 0x64)
  let mouseUp = BindingInput(type: .otherMouseUp, mouseButton: 2)
  check(both.handle(keyboardFirst ? keyUp : mouseUp).transition == nil, "first release keeps recording")
  check(both.handle(keyboardFirst ? mouseUp : keyUp).transition == "hotkey-up", "last release stops")
}

var fn = state("Fn", "MOUSE_MIDDLE")
check(fn.handle(BindingInput(type: .flagsChanged, modifiers: ["Fn"])).transition == "hotkey-down", "Fn still starts")
check(fn.handle(BindingInput(type: .flagsChanged)).transition == "hotkey-up", "Fn still releases")
check(fn.handle(BindingInput(type: .otherMouseDown, mouseButton: 2)).transition == "hotkey-down", "mouse still works after Fn")
check(fn.reset(), "tap reset reports active gesture")
check(!fn.reset(), "reset idempotent")
check(!fn.handle(BindingInput(type: .otherMouseUp, mouseButton: 2)).consume, "reset removes ownership")

var yield = state("F8", "MOUSE_4")
check(!yield.handle(BindingInput(type: .keyDown, keyCode: 0x64), shouldYield: { true }).consume, "keyboard yields")
check(!yield.handle(BindingInput(type: .otherMouseDown, mouseButton: 3), shouldYield: { true }).consume, "mouse yields")
check(!yield.handle(BindingInput(type: .otherMouseUp, mouseButton: 3)).consume, "yielded release passes")
check(!yield.handle(BindingInput(type: .keyDown, keyCode: 0x64, isRepeat: true)).consume, "unowned repeats cannot start")
check(yield.handle(BindingInput(type: .otherMouseDown, mouseButton: 3)).consume, "back button supported")
check(yield.handle(BindingInput(type: .otherMouseUp, mouseButton: 3), shouldYield: { true }).transition == "hotkey-up", "focus change preserves release")

for invalid in ["", "MOUSE_LEFT", "MOUSE_99", "Shift+Shift+MOUSE_MIDDLE", "garbage+F8", "Fn+"] {
  check((try? BindingDefinition(invalid)) == nil, "reject invalid binding")
}
print("Native binding contracts passed: middle, modifiers, overlap, repeat, release ownership, yield and reset.")
