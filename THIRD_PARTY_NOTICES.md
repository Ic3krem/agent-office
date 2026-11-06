# Third-party notices

Agent Office itself is licensed under the Apache License 2.0 (see LICENSE and NOTICE); the components below stay under their own licences, which this file lists and which are not changed by Agent Office's licence. The production dependency tree (196 packages, generated from package-lock.json on 2026-11-03) is below. Electron and electron-builder are build-time/runtime shell dependencies and are MIT.

## Not plain permissive, or needing a note

- **@anthropic-ai/claude-agent-sdk** (and its platform binaries): (c) Anthropic PBC, all rights reserved; use is subject to Anthropic's legal agreements (https://code.claude.com/docs/en/legal-and-compliance). It is a proprietary dependency, not covered by this project's Apache-2.0 licence. Installers bundle it only as an unmodified dependency; users need their own Claude Code / Anthropic account.
- **jszip** 3.10.2: dual-licensed (MIT OR GPL-3.0-or-later); Agent Office uses it under MIT.
- **pako** 1.0.11: MIT AND Zlib (both permissive).
- **buffers** 0.1.1: the npm package declares no license; its upstream project (substack/node-buffers) is MIT/X11-style. Transitive via exceljs. Verify before redistributing outside this project.
- **chainsaw** 0.1.0: MIT/X11 (permissive).

- **React 18.3.1, ReactDOM 18.3.1, @babel/standalone 7.29.0** are vendored unmodified in `public/vendor/` (MIT; (c) Meta Platforms and the Babel contributors). Their SHA-384 hashes are pinned in `public/support.js`.

- **PixiJS 8.22.0** is vendored unmodified as `public/vendor/pixi.min.js` (MIT; (c) 2013-2023 Mathew Groves, Chad Engler).

- **Pixelify Sans, IBM Plex Mono, Instrument Sans** (latin and latin-ext subsets) are vendored in `public/fonts/` and served locally, so the pages make no request to Google Fonts. All three are licensed under the SIL Open Font License 1.1; the license texts are in `public/fonts/OFL-*.txt`.

All other packages are MIT, ISC, BSD, Apache-2.0 or Unlicense.

## Full list

| Package | Version | License |
|---|---|---|
| @anthropic-ai/claude-agent-sdk | 0.3.301 | SEE LICENSE IN README.md |
| @anthropic-ai/claude-agent-sdk-darwin-arm64 | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-darwin-x64 | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-arm64 | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-arm64-musl | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-x64 | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-x64-musl | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-win32-arm64 | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-win32-x64 | 0.3.301 | SEE LICENSE IN LICENSE.md |
| @fast-csv/format | 4.3.5 | MIT |
| @fast-csv/parse | 4.3.6 | MIT |
| @types/node | 14.18.63 | MIT |
| @types/node | 14.18.63 | MIT |
| archiver | 5.3.2 | MIT |
| archiver-utils | 2.1.0 | MIT |
| archiver-utils | 3.0.4 | MIT |
| array-buffer-byte-length | 1.0.2 | MIT |
| arraybuffer.prototype.slice | 1.0.4 | MIT |
| async | 3.2.6 | MIT |
| async-function | 1.0.0 | MIT |
| available-typed-arrays | 1.0.7 | MIT |
| balanced-match | 1.0.2 | MIT |
| balanced-match | 1.0.2 | MIT |
| base64-js | 1.5.1 | MIT |
| big-integer | 1.6.52 | Unlicense |
| binary | 0.3.0 | MIT |
| bl | 4.1.0 | MIT |
| bluebird | 3.4.7 | MIT |
| brace-expansion | 1.1.21 | MIT |
| brace-expansion | 2.1.7 | MIT |
| buffer | 5.7.1 | MIT |
| buffer-crc32 | 0.2.13 | MIT |
| buffer-indexof-polyfill | 1.0.2 | MIT |
| buffers | 0.1.1 | ? |
| call-bind | 1.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| chainsaw | 0.1.0 | MIT/X11 |
| compress-commons | 4.1.2 | MIT |
| concat-map | 0.0.1 | MIT |
| core-util-is | 1.0.3 | MIT |
| crc-32 | 1.2.2 | Apache-2.0 |
| crc32-stream | 4.0.3 | MIT |
| data-view-buffer | 1.0.2 | MIT |
| data-view-byte-length | 1.0.2 | MIT |
| data-view-byte-offset | 1.0.1 | MIT |
| dayjs | 1.11.23 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| dunder-proto | 1.0.1 | MIT |
| duplexer2 | 0.1.4 | BSD-3-Clause |
| end-of-stream | 1.4.5 | MIT |
| es-abstract | 1.24.2 | MIT |
| es-abstract-get | 1.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| es-to-primitive | 1.3.4 | MIT |
| exceljs | 4.4.0 | MIT |
| fast-csv | 4.3.6 | MIT |
| for-each | 0.3.5 | MIT |
| fs-constants | 1.0.0 | MIT |
| fs.realpath | 1.0.0 | ISC |
| fstream | 1.0.12 | ISC |
| function-bind | 1.1.2 | MIT |
| function.prototype.name | 1.2.0 | MIT |
| functions-have-names | 1.2.3 | MIT |
| generator-function | 2.0.1 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| get-symbol-description | 1.1.0 | MIT |
| glob | 7.2.3 | ISC |
| globalthis | 1.0.4 | MIT |
| gopd | 1.2.0 | MIT |
| graceful-fs | 4.2.11 | ISC |
| has-bigints | 1.1.0 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-proto | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hasown | 2.0.4 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| immediate | 3.0.6 | MIT |
| inflight | 1.0.6 | ISC |
| inherits | 2.0.4 | ISC |
| internal-slot | 1.1.0 | MIT |
| is-array-buffer | 3.0.5 | MIT |
| is-async-function | 2.1.1 | MIT |
| is-bigint | 1.1.0 | MIT |
| is-boolean-object | 1.2.2 | MIT |
| is-callable | 1.2.7 | MIT |
| is-data-view | 1.0.2 | MIT |
| is-date-object | 1.1.0 | MIT |
| is-document.all | 1.0.0 | MIT |
| is-finalizationregistry | 1.1.1 | MIT |
| is-generator-function | 1.1.2 | MIT |
| is-map | 2.0.3 | MIT |
| is-negative-zero | 2.0.3 | MIT |
| is-number-object | 1.1.1 | MIT |
| is-regex | 1.2.1 | MIT |
| is-set | 2.0.3 | MIT |
| is-shared-array-buffer | 1.0.4 | MIT |
| is-string | 1.1.1 | MIT |
| is-symbol | 1.1.1 | MIT |
| is-typed-array | 1.1.15 | MIT |
| is-weakmap | 2.0.2 | MIT |
| is-weakref | 1.1.1 | MIT |
| is-weakset | 2.0.4 | MIT |
| isarray | 1.0.0 | MIT |
| isarray | 2.0.5 | MIT |
| isarray | 2.0.5 | MIT |
| isarray | 2.0.5 | MIT |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| lazystream | 1.0.1 | MIT |
| lie | 3.3.0 | MIT |
| listenercount | 1.0.1 | ISC |
| lodash.defaults | 4.2.0 | MIT |
| lodash.difference | 4.5.0 | MIT |
| lodash.escaperegexp | 4.1.2 | MIT |
| lodash.flatten | 4.4.0 | MIT |
| lodash.groupby | 4.6.0 | MIT |
| lodash.isboolean | 3.0.3 | MIT |
| lodash.isequal | 4.5.0 | MIT |
| lodash.isfunction | 3.0.9 | MIT |
| lodash.isnil | 4.0.0 | MIT |
| lodash.isplainobject | 4.0.6 | MIT |
| lodash.isundefined | 3.0.1 | MIT |
| lodash.union | 4.6.0 | MIT |
| lodash.uniq | 4.5.0 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| minimatch | 3.1.5 | ISC |
| minimatch | 5.1.9 | ISC |
| minimist | 1.2.8 | MIT |
| mkdirp | 0.5.6 | MIT |
| normalize-path | 3.0.0 | MIT |
| object-inspect | 1.13.4 | MIT |
| object-keys | 1.1.1 | MIT |
| object.assign | 4.1.7 | MIT |
| once | 1.4.0 | ISC |
| own-keys | 1.0.2 | MIT |
| pako | 1.0.11 | (MIT AND Zlib) |
| path-is-absolute | 1.0.1 | MIT |
| possible-typed-array-names | 1.1.0 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| readable-stream | 2.3.8 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 3.6.2 | MIT |
| readable-stream | 2.3.8 | MIT |
| readdir-glob | 1.1.3 | Apache-2.0 |
| reflect.getprototypeof | 1.0.10 | MIT |
| regexp.prototype.flags | 1.5.4 | MIT |
| rimraf | 2.6.3 | ISC |
| safe-array-concat | 1.1.4 | MIT |
| safe-buffer | 5.1.2 | MIT |
| safe-push-apply | 1.0.0 | MIT |
| safe-regex-test | 1.1.0 | MIT |
| saxes | 5.0.1 | ISC |
| set-function-length | 1.2.2 | MIT |
| set-function-name | 2.0.2 | MIT |
| set-proto | 1.0.0 | MIT |
| setimmediate | 1.0.5 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| stop-iteration-iterator | 1.1.0 | MIT |
| string_decoder | 1.1.1 | MIT |
| string.prototype.trim | 1.2.11 | MIT |
| string.prototype.trimend | 1.0.10 | MIT |
| string.prototype.trimstart | 1.0.8 | MIT |
| tar-stream | 2.2.0 | MIT |
| tmp | 0.2.7 | MIT |
| traverse | 0.3.10 | MIT |
| typed-array-buffer | 1.0.3 | MIT |
| typed-array-byte-length | 1.0.3 | MIT |
| typed-array-byte-offset | 1.0.5 | MIT |
| typed-array-length | 1.0.8 | MIT |
| typedarray.prototype.slice | 1.0.6 | MIT |
| unbox-primitive | 1.1.0 | MIT |
| unzipper | 0.10.14 | MIT |
| util-deprecate | 1.0.2 | MIT |
| uuid | 8.3.2 | MIT |
| which-boxed-primitive | 1.1.1 | MIT |
| which-builtin-type | 1.2.1 | MIT |
| which-collection | 1.0.2 | MIT |
| which-typed-array | 1.1.24 | MIT |
| wrappy | 1.0.2 | ISC |
| xmlchars | 2.2.0 | MIT |
| zip-stream | 4.1.1 | MIT |
| zod | 4.6.7 | MIT |
