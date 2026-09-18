# Coach Phelps — Steering Guide

For Akash and Skanda: the high-level picture of this repo.
(Agents: this file isn't for you — your boot sequence is `AGENTS.md`.)

## What this repo is

Coach Phelps is an AI coaching system: it syncs training data from Apple Health via the iOS app, runs it through a training engine, and coaches the athlete through a chat app, a web dashboard, and the iOS app. This repo is where all of that is built — one home for the engine, the apps, and the coach's brain.

## How we work

You two steer; the agents build.

- **One PR, one idea.** Each pull request does a single thing you can describe in one line. Big work gets split into a stack of small PRs, each building on the last, merged from the bottom up.
- **Every PR links its issue.** The issue is the unit of planned work; the PR is the unit of shipped work. The link between them keeps the board honest — the final PR in a stack closes the issue, the rest just reference it.
- **Every PR gets a Tech Lead review before it lands** — from `the-third-sibling`, the review bot — with an architecture diagram attached.
- **Big calls get written down.** Decisions that are hard to reverse are recorded as short decision notes: what we chose, why, and what we rejected. If one turns out wrong, we write a new note that supersedes it instead of re-litigating in chat.
- **Docs stay short and visual.** One page, plain English, led by a diagram. Anything needing more detail gets a separate deep-dive doc — the main doc never bloats.
- **Talk like a co-worker.** Short replies, one topic at a time, recommendations marked clearly. Push back with evidence when something looks wrong — silence is the failure mode, not disagreement.

## Where to look

- **ROADMAP.md** — what we're building, in what order.
- **Issues** — the work record: planned, in progress, done.
- **kdb/decisions** — the big calls and why we made them, one short write-up each.
- **docs/** — deeper dives on how things work, when you want them.
