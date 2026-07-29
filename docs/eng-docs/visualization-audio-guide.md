# Visualization Audio Guide

When writing guided visualization scripts, read `docs/ref-docs/phelps-voice-profile.md` for voice cadence, pacing, and delivery style. Match Phelps' rhythm — slow, deliberate, with pauses between cues. Don't read it at boot — only when generating visualization audio.

## Format rules

- Cue the breathing exercise with a single instruction, then insert a **60-second silence block**. The athlete counts on their own — no "two... three... four" cadence.
- Structure: Intro cue → 60s silence → Court visualization → Pressure scenario (e.g., 19-all) → Close.
- Target runtime: **4–5 minutes** to fit a morning flow window.
- Generate speech in parts and concatenate with silence using pydub/ffmpeg. Scripts and rendered tapes live in `plugins/visualization/audio/` (per-athlete, not committed to the org repo).
- Reuse what works from the previous audio; swap in fresh context (opponent, partner, tactical focus) each time.
