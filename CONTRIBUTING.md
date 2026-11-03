# Contributing to Agent Office

**External contributions are not accepted.** Agent Office is proprietary software ([LICENSE](LICENSE), all rights reserved), and a contribution can only be taken after the owner has signed a written agreement with you that assigns the rights in it. Please do not open pull requests or send patches without that agreement. **Security reports are still welcome**: see [SECURITY.md](SECURITY.md). The rest of this page is for the owner and for people the owner has invited to work on the code.

## Ground rules

- Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately, never in a public issue: see [SECURITY.md](SECURITY.md).
- The project is proprietary (all rights reserved). Contributions need a signed written agreement assigning the rights to the owner first; without one they cannot be used.

## Setting up

```
git clone https://github.com/Ic3krem/agent-office
cd agent-office
npm ci          # installs exactly what package-lock.json lists
npm test        # all test suites; they must pass
npm start       # run the desktop app
```

Requirements: Node.js 24 and [Claude Code](https://claude.com/claude-code) logged in. To run a second copy next to an installed one, set `AGENT_OFFICE_PORT` and a temporary `USERPROFILE` so it does not touch the installed app's key and state. More in [docs/RESOURCES.md](docs/RESOURCES.md).

## Making a change

1. Open an issue first for anything bigger than a small fix, so we agree on the direction.
2. Branch from `main`, keep the change focused, and add or update tests (`node --test` style, next to the code, listed in the `test` script of `package.json`).
3. Run `npm test` and `node --check <file>` on every `.mjs` file you touched.
4. A new root-level `.mjs` file must be added to `build.files` in `package.json`, or the packaged app will not start.
5. Never commit secrets, local paths, backups (`*.bak-*`), `kiro.json`, `bridge.json` or built installers. Do not add personal or company names.
6. Open a pull request using the template. Describe what changed and how you verified it.

## Dependencies and workflows

- Dependencies are pinned. Add one only with a clear reason, and check its license in `THIRD_PARTY_NOTICES.md`.
- Every `uses:` in `.github/workflows` must reference a full 40-character commit SHA with the version in a comment. A test enforces this.

## Releases

Only the maintainer publishes releases, signed offline. See [docs/RELEASING.md](docs/RELEASING.md).
