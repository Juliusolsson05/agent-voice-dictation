# Keyboard and mouse dictation bindings

Stack on feat/microphone-selection (PR #38), preserve the original checkout, and keep both PRs unmerged.

1. Configure Deepgram through encrypted local settings and disable polish. Do not put credentials in source, tests, logs, package files or GitHub.
2. Add a separate optional mouse binding with middle/button4/button5 and keyboard modifiers. Keep the existing keyboard shortcut available.
3. Use one native state machine for both triggers: match exact modifiers, preserve integration yield, consume only owned events, suppress repeats, and stop only after the last owned trigger releases. Add deterministic native tests that do not post real OS events.
4. Fix helper generation/ownership and line framing during restart (#33), and suspend native shortcuts while capturing a keyboard binding.
5. Correct existing scalar IPC argument contracts (#26) so stored-key status and removal are trustworthy.
6. Test persistence, UI and IPC contracts, compile/test Swift, run root/Electron checks, package the resulting branch, and verify the running app uses Deepgram with polish off and both bindings enabled.
7. Open a stacked PR for #39 with validation and limitations; do not merge.
