# macOS code signing & notarization

Without an Apple‑issued signature, a downloaded build is quarantined by
Gatekeeper and shows **"Claude Launcher is damaged and can't be opened"** on
Apple Silicon. Fixing that for real requires signing with a **Developer ID
Application** certificate and **notarizing** with Apple. This is done in CI by
the `build-macos` job when the five secrets below are present; if they're
absent the job falls back to an ad‑hoc (unsigned) build and logs a warning.

## One‑time setup

### 1. Apple Developer Program
Enrol at <https://developer.apple.com/programs/> ($99/yr). You need this to get
a Developer ID certificate and to notarize.

### 2. Developer ID Application certificate → `.p12`
- In Xcode (Settings → Accounts → Manage Certificates → `+` → **Developer ID
  Application**), or via <https://developer.apple.com/account/resources/certificates>.
- In **Keychain Access**, find the "Developer ID Application: …" cert, right‑click
  → **Export** → save as `cert.p12`, set an export password.
- Base64‑encode it for the secret:
  ```sh
  base64 -i cert.p12 | pbcopy   # macOS: now on your clipboard
  ```

### 3. App‑specific password (for notarytool)
- At <https://appleid.apple.com> → Sign‑In & Security → **App‑Specific Passwords**
  → generate one (e.g. name it "claude-launcher-notarize").

### 4. Team ID
- <https://developer.apple.com/account> → Membership details → **Team ID**
  (10 characters, e.g. `AB12CD34EF`).

## GitHub repository secrets

Add these under **Settings → Secrets and variables → Actions → New repository
secret** (names must match exactly):

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | base64 of `cert.p12` (step 2) |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password (step 2) |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app‑specific password (step 3) |
| `APPLE_TEAM_ID` | Team ID (step 4) |

Once all five exist, the next `v*` tag produces a signed, notarized, stapled
build that opens with no warnings and that electron‑updater can verify for
silent macOS auto‑updates.

## Notes
- Notarization adds a few minutes to the macOS build (Apple processes the
  upload). This is normal.
- Local `pnpm dist` on a Mac without these env vars will try to sign with a
  Developer ID from your keychain. To build unsigned locally, run
  `pnpm exec electron-builder --mac -c.mac.notarize=false -c.mac.identity=-`.
