# 0008 — Coach HQ iOS uses Sibling Shipyard Apple IDs

- **Status:** Accepted · 2026-07-28 · iOS Builder
- **Area:** ios
- **Context:** The app display name is **Coach HQ**, but the athlete may still run a
  legacy Phelps build (`com.coachphelps.ios`) on the same phone. A generic
  `com.coachhq.ios` ID is already owned by another Apple team. Reusing the legacy
  bundle ID would replace that install.
- **Decision:** Coach HQ owns a Sibling Shipyard identity distinct from legacy Phelps:
  bundle `com.siblingshipyard.coachhq`, widget
  `com.siblingshipyard.coachhq.CoachHQWidget`, App Group
  `group.com.siblingshipyard.coachhq`, OAuth scheme `coachhq://callback`, Keychain
  `com.siblingshipyard.coachhq.github.token`, widget kinds
  `com.siblingshipyard.coachhq.widget.*`. Xcode tree lives at `ios/CoachHQ/`.
  Display strings say Coach HQ; the Coach Phelps AI persona and GitHub repo-name
  discovery (`coach-phelps*`) stay unchanged.
- **Why:** Different bundle IDs (and matching App Group / URL scheme) are required for
  side-by-side installs. Team-owned reverse-DNS avoids the taken `com.coachhq.ios`
  and keeps signing on our Apple team.
- **Rejected:** Keep `com.coachphelps.ios` for HQ → cannot coexist with legacy.
  Use `com.coachhq.ios` → registered to another team. Change only the display name
  with no ID split → fine for rebrand-only, not for two apps on one device.
