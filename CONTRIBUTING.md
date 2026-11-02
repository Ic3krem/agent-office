# Contributing to Agent Office

Thanks for helping. This is a small project, so the process is light.

## Ground rules

- Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately, never in a public issue: see [SECURITY.md](SECURITY.md).
- The project is MIT licensed. By contributing you agree your contribution is released under the same license.

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
