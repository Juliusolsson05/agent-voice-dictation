# LAN phone microphone

Issue #43. Stack on feat/keyboard-mouse-bindings to retain the installed microphone and shortcut work.

- Add an opt-in main-process HTTP setup/HTTPS signaling service, per-installation local CA, ephemeral pairing token, single phone ownership, strict signaling limits and teardown.
- Serve a self-contained mobile page; Chrome on iPhone captures audio only after a tap and microphone permission. WebRTC without STUN/TURN carries encrypted audio directly over LAN. The setup page explains certificate installation/trust and links to the secure pairing page.
- Keep a receiving peer in the status renderer, feed cloned remote tracks into the existing MediaRecorder/Deepgram path, and cancel on disconnection. Add Phone over Wi-Fi selection, setup links/QR, connection state and meter in microphone settings.
- Verify signaling authentication/limits/disconnect, renderer stream ownership, and existing dictation tests. Build/package, inspect live UI, synchronize issue/PR, and leave phone trust/permission steps to the user.

Browser constraints: plain LAN HTTP cannot request microphone permission. The user must install and trust this installation's CA on their phone; no certificate-warning bypass or global TLS exceptions. Keep Chrome foreground/unlocked; guest Wi-Fi may isolate clients. Never send provider keys or prior transcripts to the phone.
