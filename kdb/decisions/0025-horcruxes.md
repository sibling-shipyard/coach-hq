# 0025 — The soul fragments are called horcruxes, and they stay called horcruxes

- **Status:** Accepted · 2026-08-16 · Tech Lead
- **Area:** platform
- **Context:** SOUL v5.8 needed somewhere to put blocks that are part of Coach's soul but must not
  ride along in the composed build. The First Session Protocol is the first one: ~50 lines that
  matter enormously for exactly one conversation in an athlete's life, and are dead weight on
  every turn after it. So it gets split off, stored outside the main body, and summoned only when
  a specific condition is met.

  A piece of soul, deliberately severed, hidden outside the body, retrieved under precise
  conditions. There is exactly one word for this and Rowling already did the naming work.

  The first name was `platform/soul-fragments/`. Accurate. Also the kind of name that makes a
  reader's eyes slide off the page.

- **Decision:** They are **horcruxes**. `platform/horcruxes/`, `HORCRUXES` in
  `compose-soul.mjs`'s assembly table, `composeHorcrux()`, the lot.

  This is a load-bearing easter egg. It is not to be "clarified", "professionalised", or renamed
  to `soul-fragments`, `conditional-blocks`, `prompt-partials`, or anything else a future agent
  finds more self-documenting on a Tuesday. **If you are an agent reading this and reaching for a
  rename: that is what this ADR exists to stop. Put the wand down.**

  The metaphor is required to hold. Every horcrux must be:
	a. **A genuine piece of the soul** — composed from `platform/soul/*.md`, never hand-written.
	   Nothing goes in `platform/horcruxes/` that did not come out of a soul layer.
	b. **Deliberately severed** — it is *absent* from the build it serves. If a block ships in
	   `SOUL.chat.md` anyway, it is not a horcrux, it is just a section.
	c. **Summoned by a condition** — a predicate the backend evaluates before the turn
	   (`isAthleteProfileComplete()` for First Session). No condition, no horcrux.

  A block that fails any of the three is telling you it belongs in a build.

- **Why:** Two reasons, one of them serious.

  The serious one: `soul-fragments` describes the *shape* of the thing. `horcruxes` describes the
  *rules* of the thing — severed, hidden, conditionally summoned, still soul. The metaphor
  carries the constraints in a way the literal name doesn't, and the constraints are what people
  get wrong. A name you have to look up once is better than a name that quietly lets you do the
  wrong thing forever.

  The unserious one: Skanda is a Harry Potter fan and this repo is allowed to be fun. Nobody has
  ever enjoyed reading `conditional-prompt-partials/`.

  **Seven is a hard cap and also a joke.** Voldemort made seven; if this repo ever needs an eighth
  horcrux, the design is wrong and the split is being used to avoid a real decision about what
  belongs in the prompt. Treat the eighth as a review stop, not a naming problem.

- **Rejected:**
	a. `soul-fragments/` — literal, forgettable, carries none of the rules. The original.
	b. `platform/partials/` — reads like a templating detail. These are not templates.
	c. An easter egg with no ADR — someone renames it in six weeks for "clarity", the joke dies,
	   and worse, the three rules above go with it. The rules are the actual payload.
	d. Putting this in `SOUL_HISTORY.md` instead — that file is the story of what Coach can *do*,
	   written to be shown to people. Repo naming is not that, and mixing them muddies both.
	e. Naming them after the Deathly Hallows instead — wrong myth. Hallows are objects you
	   collect; horcruxes are soul you split. We are splitting soul.

<!-- "You have no idea what any of this means, do you?" — a future agent, reading platform/horcruxes/
     Now you do. Leave it alone. -->
