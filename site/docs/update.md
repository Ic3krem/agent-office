# Update

Check for and install a new version from the island.

(Agent Office v1.2.8, 2026-11-04)


While the repository is private the updater cannot reach any release, so it reports that it could not check; updates are installed by hand from an installer the owner sends. The rest of this section describes how updates work once releases are published on a public host.

Open the island's Settings tab and use **Updates**. The app checks the signed release manifest published with the newest GitHub release of Ic3krem/agent-office. The feed address is fixed in the app; nothing in the page or in `kiro.json` can change it. A release is offered only when its `latest.json` carries a valid **Ed25519 signature** from the release key pinned in the app and a SHA-256 for the installer, and only when it is **newer** than the running version (a downgrade is never offered).

Checking on start is on by default but only checks. Installing always needs your confirmation: the app itself (not the page) shows a dialog, then downloads the installer into a fresh folder only you can access, checks the SHA-256, checks it again immediately before starting it, and quits so the installer can replace the app. You can also re-run the install script from the tag you want. Organisations that mirror releases can point the app at their own signed manifest with the `AGENT_OFFICE_UPDATE_FEED` environment variable of the app process; the signature rules still apply. Details: docs/island-spec.md; how releases are signed: docs/RELEASING.md.

