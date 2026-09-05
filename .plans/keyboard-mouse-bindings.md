# Keyboard and mouse dictation bindings

Stack on feat/microphone-selection (PR #38), preserve the original checkout, and keep both PRs unmerged.

1. Configure Deepgram through encrypted local settings and disable polish. Do not put credentials in source, tests, logs, package files or GitHub.
2. Add a separate optional mouse binding with middle/button4/button5 and keyboard modifiers. Keep the existing keyboard shortcut available.
3. Use one native state machine for both triggers: match exact modifiers, preserve integration yield, consume only owned events, suppress repeats, and stop only after the last owned trigger releases. Add deterministic native tests that do not post real OS events.
4. Fix helper generation/ownership and line framing during restart (#33), and suspend native shortcuts while capturing a keyboard binding.
5. Re-check stored-key status; #26 was a false-positive audit finding and is corrected in GitHub. No IPC payload fix is needed.
6. Test persistence, UI and IPC contracts, compile/test Swift, run root/Electron checks, package the resulting branch, and verify the running app uses Deepgram with polish off and both bindings enabled.
7. Open a stacked PR for #39 with validation and limitations; do not merge.

## Wireless iPhone follow-up (#40)

Native AVFoundation discovery and macOS Sound currently expose only the built-in input, with Mac Wi-Fi/Bluetooth on and the user confirming the nearby locked phone has Continuity Camera enabled. USB is not required for normal Continuity microphone use. Keep pairing/discovery under macOS control.

Add an explicit automatic iPhone choice, resolve current device IDs for every test/dictation, and display availability refreshed on device changes and while settings are visible. Match exposed iPhone/Continuity labels conservatively; ambiguous devices require explicit selection. Fail without opening a different input. Preserve cancellation and no background recording. Verify reconnect/absence/ambiguity in tests, then package both input features together and report physical connection separately.

## Reported non-working middle-click follow-up

The user reports middle-click does not activate dictation and requests direct input capture. Add press-to-record capture for mouse buttons (including extended buttons) and keyboard events, preserving both slots. Pause the native tap during capture and resume after release to avoid swallowing the event or leaving an unmatched release. Expose actual helper readiness/failure and last received trigger, with retry. Show failures independently from microphone availability; never silently change the user's chosen mic. Test and install the revised package, then verify the actual listener state through the UI.
