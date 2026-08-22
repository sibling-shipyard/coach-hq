# iOS App: Xcode Setup Instructions

> Status: Current · Owner: iOS Builder · Verified: 2026-08-22 · Partial — see "Unverified claims"

How to get the Coach HQ iOS app building and running on a physical iPhone from `main`.

Most of what old versions of this doc told you to configure by hand (Info.plist keys, URL scheme,
HealthKit capability, OAuth credentials) is now **committed in the project** — the only manual
steps left are signing and `Secrets.swift`.

## Prerequisites

- macOS with **Xcode 26.x**. Not optional: the app target's `IPHONEOS_DEPLOYMENT_TARGET` is 26.0
  (project-level 26.5) and `CoachHQ.xcodeproj` is `objectVersion = 77`, so older Xcode can't open
  or build it. CI pins `/Applications/Xcode_26.3.app` in `.github/workflows/ios-build.yml`.
- A physical iPhone on **iOS 26.0+**, connected via USB. HealthKit needs a real device.
- An Apple ID signed into Xcode. See the Signing step for the free-vs-paid caveat.
- **No GitHub OAuth credentials.** Sign-in uses the shared coach-phelps-hq GitHub App with
  PKCE handled entirely server-side in `ui/api/auth/` — no client ID and no client secret ever
  live in the app.

## Step 1: Clone

```bash
git clone https://github.com/sibling-shipyard/coach-phelps-hq.git
cd coach-phelps-hq
```

Build from `main`. (The old `feat/ios-app` branch is long merged and no longer exists on origin.)

## Step 2: Create `Secrets.swift`

Do this **before the first build** — the app won't compile without it.

```bash
cp ios/CoachHQ/CoachHQ/Secrets.swift.example ios/CoachHQ/CoachHQ/Secrets.swift
```

`Secrets.swift` is gitignored. It sets exactly one value, `dashboardBaseURL`, which defaults to
production (`https://coach-phelps-hq.vercel.app`). Override it only for local dashboard dev.
There is nothing else to fill in.

## Step 3: Open the Project

Open `ios/CoachHQ/CoachHQ.xcodeproj` in Xcode. Two targets build:

| Target / scheme | Product | Bundle ID |
|---|---|---|
| `CoachHQ` | app | `com.siblingshipyard.coachhq.app` |
| `CoachHQWidgetExtension` | widget extension (sources in `ios/CoachHQ/CoachHQWidget/`) | `com.siblingshipyard.coachhq.app.widget` |

The project uses file-system-synchronized groups, so files added on disk appear in the project
automatically — you never "Add Files to…" a new Swift file.

## Step 4: Signing

1. Select the top-level **CoachHQ** project (blue icon) → **Signing & Capabilities**.
2. `DEVELOPMENT_TEAM` is committed as `Z642PXCYBK`. Replace it with **your** team on both the
   `CoachHQ` and `CoachHQWidgetExtension` targets. **Automatically manage signing** is already on
   (`CODE_SIGN_STYLE = Automatic`).
   - No team listed: **Xcode → Settings → Accounts → "+" → Apple ID**, sign in, then reselect.
3. If the bundle IDs collide with something already on your account, change both together and
   keep the widget a child of the app (`<your-id>` and `<your-id>.widget`) — the widget is an
   app extension and must nest.

## Step 5: Capabilities — already configured, don't re-add

`ios/CoachHQ/CoachHQ/CoachHQ.entitlements` is committed and wired via `CODE_SIGN_ENTITLEMENTS`.
It already declares:

- `com.apple.developer.healthkit` and `...healthkit.background-delivery`
- App Group `group.com.siblingshipyard.coachhq.ios` (how the app hands snapshots to the widget;
  `ios/CoachHQ/CoachHQ/Shared/AppGroupSnapshotBridge.swift`)

`ios/CoachHQ/CoachHQWidget/CoachHQWidget.entitlements` declares the same App Group for the
extension and is wired on the widget target via `CODE_SIGN_ENTITLEMENTS`.

Likewise **do not delete `Info.plist`** (older versions of this doc said to). The project sets
both `INFOPLIST_FILE = CoachHQ/Info.plist` and `GENERATE_INFOPLIST_FILE = YES`, which is the
normal modern merge setup, not a duplicate-plist bug. `ios/CoachHQ/CoachHQ/Info.plist` already
carries `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, and the `coachhq`
URL scheme.

## Step 6: Build and Run

1. Pick your connected iPhone in the device selector (not a simulator).
2. **Cmd+R**. First build takes a few minutes.
3. On-device "Untrusted Developer": **iPhone → Settings → General → VPN & Device Management →
   your Apple ID → Trust**.

## Step 7: First Run

1. Tap **Continue with GitHub** — an in-app web view opens (`WebAuthPresenter`, shared cookie jar).
2. Setup runs two steps if the account is new: create your training-log repo, then install the
   Coach HQ GitHub App on it.
3. Tap **Connect Health** and grant HealthKit access when iOS prompts.
4. After the intro reveal you land on the four tabs: **Home · Coach · Train · You**.
5. **Sync Now** lives in the **You** tab. Tap it, then check your repo's
   `user_data/activities/hist/` for new `hk_`-prefixed JSON files.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cannot find 'Secrets' in scope` | You skipped Step 2 — copy `Secrets.swift.example`. |
| Project won't open / unsupported object version | You're on Xcode < 26. See Prerequisites. |
| "Developer not trusted" on phone | Settings → General → VPN & Device Management → Trust |
| App expires after 7 days | Free-provisioning limit. Re-run Cmd+R to redeploy. |
| Signing error on the widget only | You changed the team or bundle ID on `CoachHQ` but not `CoachHQWidgetExtension`. |
| OAuth callback not working | URL scheme must be exactly `coachhq` (lowercase). It matches `callbackScheme` in `ios/CoachHQ/CoachHQ/Services/GitHubAuthManager.swift`. |
| HealthKit permission not appearing | Must run on a real device, not a simulator. |
| Widget shows empty state | App Group mismatch, or the app hasn't written a snapshot yet — open the app and pull to refresh Home first. |
| A Run Script build phase can't find `node` (or any Homebrew tool) | Xcode's PATH usually lacks Homebrew. Start the script with `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`. |

Concurrency note: the project ships `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` and
`SWIFT_APPROACHABLE_CONCURRENCY = YES` at `SWIFT_VERSION = 5.0`. It does **not** set
`SWIFT_STRICT_CONCURRENCY`. Don't change these to silence warnings — CI builds with the
committed settings, so local overrides just hide what CI will still see.

## CI

`.github/workflows/ios-build.yml` compiles both schemes for the iOS Simulator on `macos-15` for
every `ios/**` push and PR, with `CODE_SIGNING_ALLOWED=NO` and a `Secrets.swift` copied from the
`.example`. It catches compile errors only — there is no XCTest target, and nothing about
signing, devices, or HealthKit runtime behaviour is covered. Local build on a real phone is still
the only way to verify behaviour.

## Layout

```
ios/
├── DESIGN.md
├── README.md
├── scripts/
└── CoachHQ/
    ├── CoachHQ.xcodeproj/          # 2 targets, 2 shared schemes
    ├── CoachHQ/                    # app target
    │   ├── CoachHQApp.swift
    │   ├── Info.plist
    │   ├── CoachHQ.entitlements
    │   ├── Secrets.swift.example   # → Secrets.swift (gitignored)
    │   ├── Assets.xcassets/ · Resources/
    │   ├── Models/ · Services/ · Views/
    │   └── Shared/                 # App Group bridge to the widget
    └── CoachHQWidget/              # CoachHQWidgetExtension target
```

Architecture lives in `docs/eng-docs/ios-app-spec.md`; the HealthKit → repo path is in
`docs/eng-docs/ios-sync.md`.

## Unverified claims

Everything above was checked against `ios/CoachHQ/CoachHQ.xcodeproj/project.pbxproj`, the
committed plists/entitlements, `ui/api/auth/`, and `.github/workflows/ios-build.yml`. These
could not be checked without a Mac with Xcode open, and are carried over unconfirmed:

1. Whether a **free** Apple ID (Personal Team) can provision this project at all. The App Group
   entitlement historically requires a paid Apple Developer Program membership; the older version
   of this doc claimed "free — no paid Developer Program needed", which predates the widget
   extension and its App Group. Assume you may need a paid account until someone confirms.
2. The exact Xcode UI paths in Steps 4–6 (tab names, menu items) and the 7-day free-provisioning
   expiry behaviour.
3. That the widget can actually *read* the App Group on a signed device. Both widget Debug and
   Release now set `CODE_SIGN_ENTITLEMENTS = CoachHQWidget/CoachHQWidget.entitlements` (same App
   Group as the app). Simulator CI uses `CODE_SIGNING_ALLOWED=NO`, so it will not catch a
   signing miss — confirm on a real device install.
