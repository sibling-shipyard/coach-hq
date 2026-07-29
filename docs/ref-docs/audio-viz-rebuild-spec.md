# Audio Viz Rebuild Spec
**Created:** 2026-04-12
**Context:** Weekly session discussion — Inner Game chapter 4 (communicating with Self 2 via images). Sky wants to do twice-daily visualization and make both tapes more effective.

---

## Core Principle (from the discussion)

Self 2 doesn't respond to language or technique instruction. It responds to images, feel, and sensory experience. The rebuild shifts both tapes from dense narration → cue-based prompts with silence, so Self 2 fills in the details rather than just listening.

**Cue → silence → Self 2 runs the scene.** That's the real practice.

---

## Changes: Morning Viz (`training/audio/morning_viz_part*.txt`)

### 1. Add silence gaps between scenes
After each scene resolves, insert 15–20 seconds of silence before the next cue. Let Self 2 process and run variations before moving on. Current script transitions too quickly between scenes.

Scenes that need gaps after them:
- After the box breathing silence → brief pause before hall arrival
- After the footwork/movement sequence (backhand corner, forehand side)
- After the net play scene
- After the partner rotation scene
- After the rally + point-won scene
- After the 14-10 anchor scene

### 2. Fix Self 1 language — replace technique instruction with feel
Self 2 doesn't understand biomechanics. Replace descriptive instruction with kinesthetic feel.

| Current (Self 1) | Replace with (Self 2) |
|---|---|
| "Your knee tracks over your toes" | "You feel solid and low, like you could hold that position all day" |
| "Your weight transfers smoothly" | "You feel grounded, rooted on each push" |

General rule: if it sounds like a coaching cue from the sideline, reframe it as how it feels from inside the body.

### 3. Remove negatives — flip to positive imagery only
Self 2 cannot process negatives. It hears the noun, not the negation.

| Current | Replace with |
|---|---|
| "You don't smash. You place it." | "You see the gap. The shuttle lands exactly there." |
| "You don't let Self One take over" | "You feel calm. Grounded. The shot you trust is already in your hand." |

### 4. Convert dense narration to cue-based prompts
Rather than describing everything, give a brief cue and let silence do the work. Sky's Self 2 generates more specific imagery than any script can.

Example:
> *Current:* "You push off from the center, your weight transfers smoothly, you lunge deep. Your heel stays planted. Your knee tracks over your toes..."
>
> *New:* "See yourself moving to the backhand corner." → [15s silence] → "You have the shuttle. Send it deep."

### 5. Add opponent-specific modular inserts
Before Monday Hit & Run sessions, swap in a 60–90 second opponent segment between the movement sequence and the 14-10 anchor. Pull patterns from `training/opponent_notes.md`.

Structure:
```
[Core movement scene]
→ [Opponent insert — 60-90s: see their serve, see their patterns, see yourself reading and responding]
→ [15s silence]
→ [14-10 anchor]
```

Opponent inserts should be separate short files (e.g., `morning_viz_opponent_joechung.txt`) that get concatenated into the main audio.

### 6. Decision-making rally — awareness, not pre-programming
The current script doesn't have a rally decision scene. When adding one, the focus must be on *reading* not *planning*.

**Do not:** "If they go cross-court, you drop."
**Do:** "See the rally building. Watch the shuttle early. Watch the gaps open. Your body is already moving before your mind catches up."

Cue → silence → Self 2 runs the decisions.

---

## Changes: Night Viz (`training/audio/night_viz_part*.txt`)

### 1. Add silence gaps between scenarios
The three scenarios (19-all, down 5-15, blowing a lead) are strong — keep them. But add 20 seconds of silence after each scenario resolves before cueing the next one. Let Self 2 run its own variation of the resolution.

Gaps to add:
- After 19-all point won → [20s silence] → cue disaster tape
- After the comeback from 5-15 closes → [20s silence] → cue the third-game scenario
- After final walkoff → [20s silence] → into the close

### 2. More silence after box breathing
Current: 1-minute silence for breathing, then immediately into the court arrival. Add a brief second gap (5–10s) after the breathing minute settles before the court scene begins.

### 3. Convert dense narration within scenarios to cue-based
Same principle as morning viz. Within each scenario, trim narration and let silence carry more weight.

Example (19-all scene):
> *Current:* "You take a breath. You split step. You bounce. You stay low. You feel the floor under your feet. You're grounded."
>
> *New:* "You take a breath." → [5s silence] → "You feel the floor." → [5s silence] → cue the serve.

### 4. Keep the three core scenarios — they're working
The content is right. The 19-all, 5-15 disaster, and third-game decider cover the most critical mental situations. No scenario changes needed — just pacing and silence.

---

## Twice-Daily Structure

| Session | Tape | Purpose |
|---|---|---|
| Morning (post-exercise, pre-shower) | Morning viz | Load intention — process, movement, discipline |
| Night (before sleep) | Night viz | Problem-solve adversity — pressure, resilience, reset |

---

## Build Notes (for Sky / pipeline)
- Rebuild scripts as `.txt` files first, then regenerate audio using pydub/ffmpeg
- Silence blocks: use existing silence concatenation pipeline
- Opponent inserts: modular files, concatenated based on day of week (Monday = insert relevant opponent if known)
- Target runtime: Morning 4–5 min | Night 5–6 min
- Keep `part1` / `part2` naming for silence concatenation compatibility
