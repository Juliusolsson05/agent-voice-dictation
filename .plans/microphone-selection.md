# Microphone selection and Electron audit

Start from current origin/main; preserve the original checkout's uncommitted signing changes.

1. Audit all Electron source, native hotkey integration, recording/provider boundaries, persistence, and build/test configuration. Record independently meaningful findings in GitHub Issues after checking for duplicates.
2. Add a persistent system-default or explicit microphone picker. Enumerate devices without starting capture; request access only through an explicit local test. Refresh on device changes and retain unavailable selections.
3. Use the selected device for every new dictation. A disconnected explicit selection must produce actionable feedback, never silently switch to another microphone. Settings changes apply to the next recording.
4. Add a local input meter with deterministic cleanup on stop, selection change, unmount, failed acquisition, and delayed permission responses. No audio from this test is sent to a provider.
5. Test device selection, permission failures, device removal, and capture cleanup. Run root checks, Electron tests/typecheck/build, and inspect the UI where feasible without using provider keys or recording user speech.
6. Review the diff, synchronize feature/bug Issues, and open a PR with validation and prioritized audit recommendations. Do not merge.

The iPhone is supported when macOS exposes it as a Continuity microphone; this change does not implement an iPhone companion app or continuous background recording.
