# Security policy

Agent Office is a local desktop app maintained by [Ic3krem](https://github.com/Ic3krem). It is proprietary software (see [LICENSE](LICENSE)); security reports from anyone are welcome and are not a contribution of code. It runs a server bound to `127.0.0.1`, starts your own Claude Code agents and can update itself, so security reports are taken seriously.

## Supported versions

Only the latest release receives security fixes. Please reproduce on the latest release before reporting.

| Version | Supported |
| --- | --- |
| Latest release (see [Releases](https://github.com/Ic3krem/agent-office/releases/latest)) | Yes |
| Older releases | No |

## Reporting a vulnerability

Please report privately through **GitHub Security Advisories**: open the repository's **Security** tab, choose **Report a vulnerability**, and describe the issue. Do not open a public issue or pull request for a vulnerability. If private reporting is not available to you, open a public issue that says only that you have a security report and want a private channel, without any details.

Helpful details: affected version, operating system, what an attacker needs (local access, a malicious web page, a malicious file or feed), steps to reproduce, and the impact you see.

You can expect an acknowledgement within a few days. Fixes are released as a new version and credited in the advisory unless you prefer to stay anonymous.

## What is in scope

- The Electron shell, the local server and its API key handling, the Content-Security-Policy and window hardening.
- The update path: the signed release manifest, the pinned release key, the install scripts and the downloaded installer checks.
- The release workflow and the files published with a release.

Out of scope: issues that need an attacker who already runs code as your user, and vulnerabilities in Claude Code or other third-party software (report those to their maintainers).

## Release signing key

Releases carry an Ed25519-signed manifest. The public key is pinned in `desktop/update-key.mjs`, `install.ps1` and `install.sh`. Compare it with this fingerprint (SHA-256 of the raw 32-byte public key):

```
0b380644373af6f07c2d78149f958778c299cf673ca1c5b0152da0e0a6d76139
```

Windows and macOS builds are not yet Authenticode or Apple signed (see [docs/RELEASING.md](docs/RELEASING.md)); the manifest signature and SHA-256 are what authenticate an update.
