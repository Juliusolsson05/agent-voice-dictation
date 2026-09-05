# Focus-aware Agent Code routing and installed helper

Issue #45; stack on the LAN phone microphone branch.

1. Add bounded native AX keyboard-focus inspection for enabled yield targets. Yield only to an enabled editable text role; pointer position is irrelevant. Preserve held-key release ownership.
2. Query the same policy before automatic paste. If Agent Code is focused but accessibility inspection fails, keep the transcript on the clipboard instead of guessing an insertion target.
3. Bundle the compiled helper inside the signed app for packaged execution; retain source-hashed compilation only for development. Sign this local installation with an available non-revoked Apple Development identity and install in /Applications.
4. Update integration copy, enable the focused exception in the user's settings, verify native policy/regression tests, package/build tests, and live listener status. Refresh the existing Accessibility grant for the installed app through System Settings.

No global security settings or certificate validation bypass. No merge. Live permission confirmation remains a macOS user action when authentication is requested.
