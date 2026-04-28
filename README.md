# agent-voice-dictation

Lean voice dictation primitives for agent composer UIs.

V1 intentionally stays small:

- browser recorder + audio levels
- direct STT clients for AssemblyAI, Deepgram, OpenAI, Gladia, and ElevenLabs
- OpenRouter transcript polish client
- a thin pipeline that composes speech detection and polish

Host apps own secrets, UI, persistence, and insertion into their composer.

## Boundary

`speech/` talks to speech-to-text APIs only.

`openrouter/` talks to OpenRouter only.

`recorder/` captures browser microphone audio only.

`pipeline/` composes those pieces.
