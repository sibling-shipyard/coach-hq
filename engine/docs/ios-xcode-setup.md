# iOS App: Xcode Setup Instructions

This document provides step-by-step instructions to get the Coach HQ iOS app building and running on a physical iPhone from the `feat/ios-app` branch.

## Prerequisites

- macOS with Xcode 15+ installed (iOS platform component only)
- A physical iPhone connected via USB (HealthKit requires a real device, not simulator)
- An Apple ID (free — no paid Developer Program needed)
- The GitHub OAuth App already created (you should have `Client ID` and `Client Secret`)

## Step 1: Clone and Checkout

```bash
git clone https://github.com/akash-suresh/coach-phelps.git
cd coach-phelps
git checkout feat/ios-app
```

## Step 2: Open the Project

Open `ios/CoachHQ/CoachHQ.xcodeproj` in Xcode.

## Step 3: Fix Signing

1. In the left sidebar (Project Navigator), click the top-level **CoachHQ** project (blue icon).
2. Select the **CoachHQ** target in the targets list.
3. Go to the **Signing & Capabilities** tab.
4. Check **Automatically manage signing**.
5. Under **Team**, select your Personal Team (your Apple ID).
   - If no team appears: go to **Xcode → Settings → Accounts → "+" → Apple ID** and sign in first.
6. The **Bundle Identifier** should be `com.coachhq.ios`. If it shows a conflict, change it to something unique like `com.yourname.coachhq`.

## Step 4: Fix Duplicate Info.plist Error

The project has a custom `Info.plist` file but Xcode is also auto-generating one. Fix this:

1. In the Project Navigator, find and **delete** the file `CoachHQ/Info.plist` (choose "Move to Trash").
2. Select the **CoachHQ** target → **Info** tab.
3. Under **URL Types**, click the **+** button and add:
   - **Identifier:** `com.coachhq.oauth`
   - **URL Schemes:** `coachhq`
4. Still in the **Info** tab, under **Custom iOS Target Properties**, click **+** and add these keys:
   - Key: `Privacy - Health Share Usage Description`
   - Value: `Coach HQ needs access to your health data to sync workouts, heart rate, and recovery metrics to your coaching dashboard.`

## Step 5: Add HealthKit Capability

1. Select the **CoachHQ** target → **Signing & Capabilities** tab.
2. Click **+ Capability** (top left of the tab).
3. Search for **HealthKit** and add it.
4. In the HealthKit section that appears, check **Background Delivery**.

## Step 6: Configure OAuth Credentials

1. Open `CoachHQ/Services/GitHubAuthManager.swift`.
2. Replace the placeholder values:
   ```swift
   private let clientId = "YOUR_ACTUAL_CLIENT_ID"
   private let clientSecret = "YOUR_ACTUAL_CLIENT_SECRET"
   ```

## Step 7: Select Build Target

1. In the top toolbar, click the device selector (next to the play button).
2. Select your connected iPhone (not a simulator).
3. If your phone doesn't appear, ensure it's connected via USB and you've trusted the computer on the phone.

## Step 8: Build and Run

1. Press **Cmd+R** (or click the Play button).
2. First build may take a minute.
3. If you see a "Developer not trusted" error on your phone: go to **iPhone → Settings → General → VPN & Device Management → your Apple ID → Trust**.
4. The app should launch on your phone.

## Step 9: Test the App

1. Tap **Sign in with GitHub** — a Safari sheet will open.
2. Log in to GitHub and authorize the app.
3. Grant HealthKit permissions when prompted.
4. Tap **Sync Now** to pull recent workouts from Apple Health into your repo.
5. Check your GitHub repo's `training/activities/history/` folder for new `hk_` prefixed JSON files.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Developer not trusted" on phone | Settings → General → VPN & Device Management → Trust |
| App expires after 7 days | Just hit Cmd+R in Xcode again to re-deploy |
| "No such module 'HealthKit'" | Ensure you added the HealthKit capability (Step 5) |
| OAuth callback not working | Verify URL Scheme is exactly `coachhq` (lowercase, no colon or slashes) |
| HealthKit permission not appearing | Must run on a real device, not simulator |
| Build fails with Sendable warnings | These are warnings, not errors. Set **Strict Concurrency Checking** to **Minimal** in Build Settings if they bother you |

## File Structure After Setup

```
ios/CoachHQ/
├── CoachHQ.xcodeproj/
└── CoachHQ/
    ├── CoachHQApp.swift
    ├── Assets.xcassets/
    ├── Models/
    │   ├── Activity.swift
    │   └── SyncCache.swift
    ├── Services/
    │   ├── ActivityMapper.swift
    │   ├── ActivityNamer.swift
    │   ├── DescriptionParser.swift
    │   ├── GitHubAPIClient.swift
    │   ├── GitHubAuthManager.swift
    │   └── HealthKitSyncManager.swift
    └── Views/
        ├── ActivityDetailView.swift
        ├── ActivityListView.swift
        ├── LoginView.swift
        ├── MainTabView.swift
        ├── SettingsView.swift
        ├── SyncStatusView.swift
        └── WorkoutPlaceholderView.swift
```
