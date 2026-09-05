import ApplicationServices
import AppKit
import Foundation

struct YieldConfig: Decodable {
  let frontmostBundleIds: [String]?
  let frontmostAppNames: [String]?
}

func isEditableTextRole(_ role: String?, enabled: Bool, valueSettable: Bool) -> Bool {
  // Never inspect field contents, selection text or pointer coordinates. The
  // accessibility role and writability describe the insertion target without
  // collecting what the user is typing. Read-only transcript panes must not
  // disable global dictation just because they expose a text-area role.
  return enabled && valueSettable && ["AXTextField", "AXTextArea", "AXComboBox"].contains(role ?? "")
}

func shouldYieldForTextFocus(_ config: YieldConfig, forPaste: Bool = false) -> Bool {
  guard let app = NSWorkspace.shared.frontmostApplication else { return forPaste }
  let matches = config.frontmostBundleIds?.contains(app.bundleIdentifier ?? "") == true
    || config.frontmostAppNames?.contains(app.localizedName ?? "") == true
  guard matches else { return false }
  let application = AXUIElementCreateApplication(app.processIdentifier)
  // The event tap must never wait indefinitely for a busy Electron renderer.
  // Query only on matching shortcut edges, with a bounded timeout per AX call.
  AXUIElementSetMessagingTimeout(application, 0.03)
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &value) == .success,
        let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return forPaste }
  let element = unsafeBitCast(value, to: AXUIElement.self)
  AXUIElementSetMessagingTimeout(element, 0.03)
  var role: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role) == .success else { return forPaste }
  var enabled: CFTypeRef?
  _ = AXUIElementCopyAttributeValue(element, kAXEnabledAttribute as CFString, &enabled)
  var writable = DarwinBoolean(false)
  let result = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &writable)
  // A failed lookup cannot establish a focused editor. For shortcut routing we
  // allow normal dictation; at insertion we keep the text on the clipboard
  // rather than guess that an Agent Code field is safe to paste into.
  guard result == .success else { return forPaste }
  return isEditableTextRole(role as? String, enabled: (enabled as? Bool) != false, valueSettable: writable.boolValue)
}
