# Releasing Agent Office

Releases are built and tested by the maintainer, then **signed offline**. Nothing signs in CI and the private key never leaves the maintainer's machine.

## What users verify

Every release publishes, next to the installers:

- `latest.json`: the release manifest (version, per-platform installer URL, SHA-256, size).
- `latest.json.sig`: base64 Ed25519 signature over the exact bytes of `latest.json`.

The app (`desktop/updater.mjs`) and the install scripts (`install.ps1`, `install.sh`) check the signature against the public key pinned in the code (`desktop/update-key.mjs`, copied into both scripts), then check each installer's SHA-256. A release without a valid manifest cannot be installed through the updater or the scripts.

## Cutting a release

1. Branch is clean and `npm ci && npm test` pass.
2. Bump `version` in `package.json` (and `package-lock.json`) and add the entry to [CHANGELOG.md](../CHANGELOG.md).
3. Build: `npm run dist` (Windows installer, `dist/TiroAgents-Setup-<version>.exe`). For macOS and Linux run the manual `release` workflow or build on those systems. Install the exact build you will ship and check the dashboard renders.
4. Sign the manifest (private key: see below):
   ```
   node scripts/sign-release.mjs --version <version> --out release-out \
     --asset win32=dist/TiroAgents-Setup-<version>.exe
   ```
   Add `--asset darwin/arm64=...`, `--asset darwin/x64=...`, `--asset linux/x64=...` for other platforms. The script hashes the files, writes `release-out/latest.json` and `latest.json.sig`, and verifies the result against the pinned public key before it exits. Check it again at any time with `node scripts/sign-release.mjs --verify release-out`.
5. Bump `DEFAULT_TAG` in `install.ps1` and `install.sh` (`defaultTag` / `DEFAULT_TAG`) to `v<version>` and the tag in the README install commands, commit, and tag that commit.
6. Publish exactly the tested files:
   ```
   gh release create v<version> --target <commit> --latest \
     dist/TiroAgents-Setup-<version>.exe release-out/latest.json release-out/latest.json.sig
   ```
   The manifest URLs are `https://github.com/Ic3krem/agent-office/releases/download/v<version>/<file>`, so the release tag must be `v<version>` and the asset names must match the manifest.
   Attach the party server from tracked files only, never by zipping the folder (it holds the host's `.env`):
   ```
   git archive -o party-server.zip v<version>:party
   gh release upload v<version> party-server.zip
   ```
7. Verify as a user would: `AGENT_OFFICE_VERIFY_ONLY=<folder with the downloaded manifest and signature> bash install.sh`, then install the published build once.

`.github/workflows/release.yml` is manual-only. Its builds are unsigned by the release key; if you use it, download the artifacts, sign them as above and attach `latest.json` and `latest.json.sig` to the release.

## Key custody

- Algorithm: Ed25519. The **private key** lives at `C:\Users\<you>\.agent-office-signing\release-ed25519.key` (PKCS#8 PEM), outside every repository, with an ACL that grants only the maintainer's account. Override the location with `AGENT_OFFICE_SIGNING_KEY`. `sign-release.mjs` refuses a key stored inside the repository.
- Never commit it, paste it into an issue or chat, put it in CI secrets, or print it. Keep an encrypted offline backup (for example a password manager attachment or an encrypted USB stick). Losing it means a key rotation.
- The **public key** is pinned in `desktop/update-key.mjs`, `install.ps1` and `install.sh`. Its SHA-256 fingerprint is published in [SECURITY.md](../SECURITY.md):
  `0b380644373af6f07c2d78149f958778c299cf673ca1c5b0152da0e0a6d76139`.

## Rotating the key

Needed if the private key leaks, is lost, or the maintainer changes.

1. Generate a new pair (Node: `crypto.generateKeyPairSync('ed25519')`), store the new private key as above, and note the raw 32-byte public key (base64) and its SHA-256 fingerprint.
2. Ship **one transitional release signed with the old key** that contains the new public key in `desktop/update-key.mjs`, `install.ps1` and `install.sh`. Installed apps accept it (old signature) and from then on trust the new key.
3. Sign every later release with the new key; update the fingerprint in SECURITY.md and the tests that check it.
4. If the old key leaked, users on versions that still pin it cannot be moved safely over the update channel: publish an advisory telling them to reinstall from a verified download, and delete or replace older releases.

## Authenticode and Apple signing (not set up yet)

The Windows installer is not Authenticode signed and the macOS app is not signed or notarised, because no certificates exist yet. Windows SmartScreen shows a warning for an unsigned installer. The manifest signature above still authenticates updates. The release pipeline is ready for certificates, with no code change:

- **Windows:** obtain a code-signing certificate (an EV or OV certificate from a CA, or Azure Trusted Signing). Export it as a `.pfx`, base64-encode it and add repository secrets `CSC_LINK` (the base64 or URL) and `CSC_KEY_PASSWORD`. In `release.yml` remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and pass the two secrets to the build step. For local builds set the same `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables before `npm run dist`.
- **macOS:** an Apple Developer ID Application certificate as `CSC_LINK` / `CSC_KEY_PASSWORD`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarisation.
- Signing the installer changes its hash, so run `sign-release.mjs` on the final signed file.

## Packaging notes

The app ships in `app.asar` with Electron fuses that verify the asar's integrity and load the app only from it (`build.electronFuses` in `package.json`). `RunAsNode` stays enabled on purpose: the desktop shell starts the office server as `ELECTRON_RUN_AS_NODE=1 "Agent Office.exe" server.mjs`. `desktop/nowplaying.ps1` is unpacked (`asarUnpack`) because PowerShell cannot read inside an asar. After changing the build, start the packaged app once and confirm the dashboard, the island and now-playing work before releasing.
