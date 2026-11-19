# Meeting Room With Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A meeting room in the town where party members talk by voice (direct WebRTC audio between apps), with mute, listen-only, reactions and raise hand. Ships as 2.1.0.

**Architecture:** The page captures audio and holds one `RTCPeerConnection` per other person in the room. Setup messages (`rtc`) travel page → local `server.mjs` → `party-client.mjs` → party server, which relays them only between members who hold a voice slot in room `meet`. The party server decides the slots (first come, max 8). No audio touches any server.

**Tech Stack:** Node 24 ESM (zero-dependency party server), Electron 43, browser WebRTC + Web Audio, PixiJS 8 / Canvas2D scenes, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-meeting-room-voice-design.md` (read it first; this plan argues from it).

## Global Constraints

- Free to run: no paid service, account, API key, or new npm dependency. `party/` stays zero-dependency.
- Nothing captures the microphone without a click in that page load. Leaving the room stops every track.
- Everything crossing the party goes through a cleaner in `party/protocol.mjs` on both sides; `rtc` and reactions are never stored (not in `chat`, not in `hello`).
- Caps, verbatim from the spec: voice slots **8**; SDP **8 KB** (8192 bytes); ICE candidate **512 bytes**; connect timeout **10 s**, then one ICE restart; reactions: **6** fixed, shown about **3 s**.
- Default ICE servers: `stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`. A user's TURN relay stays on their machine.
- Every `/api` write needs the session nonce (follow the neighbouring `/api/party/*` cases in `server.mjs`).
- Animations honour reduced motion, Power saver and the Low preset; Canvas2D fallback must work without a GPU; prefer GPU textures over decoded RAM copies. `npm run perf:town` and office-perf budgets must still pass.
- Commits use the GitHub noreply author already configured in this worktree. Push only to `origin` (the private repo). Never push to the public repo from this worktree.
- New test files must be added to the `test` script list in `package.json` (it names every file).
- Version: bump `package.json` and `package-lock.json` together to `2.1.0` (Task 9); `repo.test.mjs` checks they match.

## Review Focus

1. A member who never entered `meet` (or lost their slot) posts `/rtc`: it must be refused, and nothing reaches the target. (Task 2)
2. Someone drops off the network mid-call without leaving: the server reaps them (90 s), their slot passes to the longest waiter, and peers close the dead connection and release nothing of their own mic. (Tasks 2, 6)
3. The OS or the user refuses the microphone, or no input device exists: the person lands in listen-only with a message, still hears others. (Task 6)
4. `rtc` `data` that is not SDP/candidate text (chat smuggling, oversized, control characters): rejected by `cleanRtc` on both sides. (Task 1)
5. A 2.1 app joins a party hosted by 2.0: the room shows "The host needs TiroAgents 2.1 for voice" and never prompts for the mic. (Task 3)

## File Structure

| File | Responsibility |
|---|---|
| `party/protocol.mjs` (modify) | `cleanRtc`, `cleanEmote`, `EMOTES`, avatar `room: 'meet'`, `mic`, `hand`; limits |
| `party/server.mjs` (modify) | voice slots, `rtc` relay, emote relay, `/rtc` and `/emote` routes |
| `party-client.mjs` (modify) | `rtc()`, `emote()`, incoming `rtc`/`emote`/`voice` events, `voice` capability in `view()` |
| `server.mjs` (modify) | `/api/party/rtc`, `/api/party/emote`, `/api/party/voice-config`; deliver incoming rtc/emote to the page |
| `voice-config.mjs` (create) | read/write the user's optional TURN relay in the config dir; build `iceServers` |
| `desktop/media-permissions.mjs` (create) | pure permission policy `decidePermission()` |
| `desktop/main.mjs`, `package.json` (modify) | install the handlers; macOS mic description |
| `public/world-templates/interior-meet.json` (create), `public/town/town.json`, `public/town-map.js`, `public/world-model.js`, `public/office-world.js`, `public/Agent Office.html` (modify) | the `meet` lot and scene |
| `public/meet-voice.js` (create) | voice engine: pure core (`MeetVoiceCore`) + WebRTC/Web Audio wiring |
| `public/meet-room.js` (create) | consent card, room list, mute/hand/reaction controls, indicator, music ducking |
| `perf/meet-check.cjs` (create) | two-instance live check with a fake microphone |

---

### Task 1: Protocol cleaners

**Files:** Modify `party/protocol.mjs`. Test `party.test.mjs`.

**Interfaces — Produces:**
- `LIMITS.sdp = 8192`, `LIMITS.ice = 512`, `LIMITS.voice = 8`
- `EMOTES = ['wave','clap','laugh','heart','thumbs','party']`
- `cleanRtc(v) -> { to: string, kind: 'offer'|'answer'|'ice', data: string } | null` — `to` matches `/^[A-Za-z0-9_-]{1,16}$/`; `data` is a string within the cap for its kind, contains only printable ASCII plus `\r\n`, and for `offer`/`answer` starts with `v=0`, for `ice` starts with `candidate:` or is `''` (end of candidates).
- `cleanEmote(v) -> 0..5 | null` (integer index into `EMOTES`).
- `cleanAvatar` accepts `room: 'meet'`; when room is `meet` it keeps `mic: 'on'|'muted'|'listen'` (default `'listen'`) and `hand: true` (only when true); outside `meet` both are dropped.

- [ ] **Step 1: Failing tests** in `party.test.mjs`:

```js
test('cleanRtc: shape, caps, and no smuggling', () => {
  const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n';
  assert.deepEqual(cleanRtc({ to: 'abc123', kind: 'offer', data: sdp, extra: 1 }), { to: 'abc123', kind: 'offer', data: sdp });
  assert.equal(cleanRtc({ to: 'abc123', kind: 'offer', data: 'hello there' }), null);
  assert.equal(cleanRtc({ to: 'abc123', kind: 'offer', data: 'v=0\r\n' + 'a'.repeat(8192) }), null);
  assert.ok(cleanRtc({ to: 'abc123', kind: 'ice', data: 'candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host' }));
  assert.deepEqual(cleanRtc({ to: 'abc123', kind: 'ice', data: '' }), { to: 'abc123', kind: 'ice', data: '' });
  assert.equal(cleanRtc({ to: 'abc123', kind: 'ice', data: 'candidate:' + 'x'.repeat(512) }), null);
  assert.equal(cleanRtc({ to: 'abc123', kind: 'ice', data: 'candidate:1 \u0000 evil' }), null);
  assert.equal(cleanRtc({ to: '../x', kind: 'ice', data: '' }), null);
  assert.equal(cleanRtc({ to: 'abc123', kind: 'chat', data: '' }), null);
});
test('cleanAvatar: meet room carries mic and hand, other rooms drop them', () => {
  assert.deepEqual(cleanAvatar({ x: 1, y: 2, room: 'meet', mic: 'on', hand: true }), { x: 1, y: 2, room: 'meet', presence: 'available', mic: 'on', hand: true });
  assert.equal(cleanAvatar({ room: 'meet', mic: 'shouting' }).mic, 'listen');
  assert.equal('mic' in cleanAvatar({ room: 'town', mic: 'on', hand: true }), false);
  assert.equal('hand' in cleanAvatar({ room: 'town', mic: 'on', hand: true }), false);
});
test('cleanEmote: index into the fixed list only', () => {
  assert.equal(EMOTES.length, 6); assert.equal(cleanEmote(5), 5);
  for (const bad of [6, -1, 1.5, '1', null, 'wave']) assert.equal(cleanEmote(bad), null);
});
```

- [ ] **Step 2:** `node --test party.test.mjs` → the three new tests FAIL (not exported).
- [ ] **Step 3:** Implement the exports above; extend the file's header comment to list "connection setup data (SDP and ICE candidates, which contain IP addresses), to the addressed member only" and "one reaction from a fixed list".
- [ ] **Step 4:** `node --test party.test.mjs` → PASS.
- [ ] **Step 5:** Commit `Party protocol: rtc, emote and meeting-room avatar fields`.

### Task 2: Party server — voice slots and relays

**Files:** Modify `party/server.mjs`. Test `party.test.mjs`.

**Interfaces — Consumes:** Task 1 exports.
**Produces:**
- Member record gains `meetAt: number | 0` (when its room became `meet`) and `voice: boolean`.
- `pub(m)` includes `voice`. Event `{ t: 'voice', ids: string[] }` (the current slot holders, in entry order) goes to **all** members whenever the set changes; `hello` includes `voice: string[]` and `caps: ['voice']`.
- `party.rtc(m, body) -> { ok: boolean, error?: string }`: cleans with `cleanRtc`; refuses unless sender and target both hold a slot; delivers `{ t: 'rtc', from: m.id, kind, data }` to the target only; stores nothing.
- `party.emote(m, body) -> boolean`: `cleanEmote`; sender must be in `meet`; delivers `{ t: 'emote', id: m.id, emote }` to members in `meet` only.
- Routes `POST /rtc` and `POST /emote` beside `/chat`, each with its own limiter built with the file's existing limiter helper: rtc burst 60 at 20/s per member; emote burst 5 at 1/s. Body cap 16384 for `/rtc`, 4096 for `/emote`.
- Slot rule: on `avatar()` when room becomes `meet` set `meetAt = now()`; when it leaves `meet`, and on `leave()` (any reason, including reap/kick), clear it. Recompute holders = the 8 members with the smallest `meetAt` (ties by `seq`); a holder is never displaced by a newcomer.

- [ ] **Step 1: Failing tests** in `party.test.mjs` (use `createParty` directly with a fake `now`, as the existing tests do):

```js
test('voice: first 8 into the room hold slots; the ninth waits and is promoted when one leaves', () => { /* join 9, each avatar({room:'meet'}) at increasing now; assert last 'voice' ids = first 8 ids in order; member 1 avatar({room:'town'}) -> ids = members 2..9 */ });
test('voice: a slot holder is not displaced, and reap/kick/leave free the slot', () => { /* holder set stable when a 9th enters; party.kick(id) and reap() after 90 s each emit a new 'voice' without that id */ });
test('rtc: relayed to the addressed slot holder only, never stored', () => { /* a,b in meet, c in town; rtc(a,{to:b.id,kind:'ice',data:''}) -> b.send got {t:'rtc',from:a.id,kind:'ice',data:''}; c.send and a.send got none; hello(b) JSON has no 'rtc' */ });
test('rtc: refused when sender or target has no slot, or the body is not clean', () => { /* c -> b refused; a -> c refused; a -> b with data 'hi' refused; a -> missing id refused; each returns ok:false and delivers nothing */ });
test('emote: reaches people in the room only, fixed list only', () => { /* emote(a, {emote: 2}) -> b gets {t:'emote',id:a.id,emote:2}; c gets none; emote(a,{emote:9}) false; emote(c,{emote:1}) false */ });
```

Write each body out fully in the style of the neighbouring tests (collect events with a per-member `send` spy).

- [ ] **Step 2:** `node --test party.test.mjs` → new tests FAIL.
- [ ] **Step 3:** Implement the rules and routes above.
- [ ] **Step 4:** `node --test party.test.mjs party-host.test.mjs` → PASS.
- [ ] **Step 5:** Commit `Party server: voice slots, rtc and reaction relays`.

### Task 3: App side — party client and local API

**Files:** Modify `party-client.mjs`, `server.mjs`. Create `voice-config.mjs`. Tests: `party.test.mjs`, create `voice-config.test.mjs`.

**Interfaces — Consumes:** Task 2 events and routes.
**Produces:**
- `createPartyClient({ ..., onSignal = () => {} })`; `onSignal({ type: 'rtc', from, kind, data } | { type: 'emote', id, emote })` fires for incoming events after re-cleaning (drop unclean ones).
- Client methods `rtc({ to, kind, data }) -> Promise<{ ok, error? }>` and `emote(n) -> Promise<boolean>`; a 404 from `/rtc` sets voice support to `'host-old'`.
- `view()` gains `voice: { support: 'ok' | 'host-old', ids: string[], mine: boolean }` (`support` is `'host-old'` when `hello` had no `caps` including `'voice'`).
- `server.mjs`: `POST /api/party/rtc` → `partyClient.rtc(b)`; `POST /api/party/emote` → `partyClient.emote(b.emote)`; `GET /api/party/voice-config` → `{ iceServers }`; `POST /api/party/voice-config` `{ turn: { url, user, pass } | null }`. Incoming signals are written to the page's existing event stream as their own message kind (`signal`), not folded into the snapshot.
- `voice-config.mjs`: `readVoiceConfig(dir) -> { turn: {url,user,pass} | null }`, `writeVoiceConfig(dir, cfg)`, `iceServers(cfg) -> RTCIceServer[]` (the two default STUN URLs, plus the TURN entry when set). TURN `url` must match `/^turns?:[A-Za-z0-9.-]+(:\d{1,5})?(\?transport=(udp|tcp))?$/`; `user`/`pass` are strings ≤ 128; anything else is rejected. A corrupt file reads as `{ turn: null }`. File: `voice.json` in the app's config dir (`CFG_DIR`).

- [ ] **Step 1: Failing tests.** `voice-config.test.mjs`:

```js
test('iceServers: STUN defaults, TURN added only when valid', () => {
  assert.deepEqual(iceServers({ turn: null }), [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]);
  assert.equal(iceServers({ turn: { url: 'turn:relay.example.org:3478', user: 'u', pass: 'p' } })[1].urls, 'turn:relay.example.org:3478');
});
test('writeVoiceConfig rejects bad TURN urls; a corrupt file reads as no relay', () => { /* 'https://x', 'turn:a b', 300-char user -> throws; write garbage to voice.json -> readVoiceConfig(dir).turn === null */ });
```

In `party.test.mjs` (fake `fetchImpl`, like the existing client tests): hello without `caps` → `view().voice.support === 'host-old'`; `/rtc` 404 → same; an incoming `{t:'rtc'}` with unclean `data` does not call `onSignal`; a clean one does with `{type:'rtc',from,kind,data}`; `{t:'voice',ids}` updates `view().voice.ids` and `mine`.

- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement. In `server.mjs` find the page event stream (`text/event-stream`, near line 777) and the `/api/party/*` cases (near line 924) and follow their nonce and JSON conventions exactly.
- [ ] **Step 4:** `node --test party.test.mjs voice-config.test.mjs hardening.test.mjs security.test.mjs` → PASS. Add `voice-config.test.mjs` to the `test` script.
- [ ] **Step 5:** Commit `App: party voice signalling, reactions API and relay setting`.

### Task 4: The `meet` lot and scene

**Files:** Create `public/world-templates/interior-meet.json`. Modify `public/town/town.json`, `public/town-map.js` (`LOT_IDS`, `KINDS`, `ENTER`, `lotOfScene`), `public/world-model.js` (`INTERIORS`), `public/office-world.js` (`setScene`), `public/Agent Office.html` (the two `['office','kain','games']` lists near lines 693 and 761), and wherever the page reports its avatar room (`/api/party/avatar`) so scene `meet` reports `room: 'meet'`. Tests: `town-map.test.mjs`, `world-model.test.mjs`, `town-static.test.mjs`.

**Interfaces — Produces:** scene name `'meet'`; `ENTER.meet = ['/#scene=meet', 'Enter the meeting room']`; interior template with `"scene": "meet"`, a table, at least 8 seat pieces, and a spawn by the door. Agents never travel there (`agent-travel.js` `DESTS` unchanged).

- [ ] **Step 1: Failing tests:** town-map — the map has a lot with id and kind `meet`, a door, and a walkable path from the home door to the meet door; `lotOfScene('meet') === 'meet'`. world-model — `interior-meet.json` validates and has ≥ 8 seats; `'meet'` is an interior. Follow the existing `games` assertions in each file.
- [ ] **Step 2:** Run the three files → FAIL.
- [ ] **Step 3:** Implement. Place the lot on free ground in `town.json`; for the building use new art through `npm run art` if it stays inside the art and perf budgets, otherwise reuse the `gamehall` building type with a distinct sign. Model the interior JSON on `interior-games.json`.
- [ ] **Step 4:** `node --test town-map.test.mjs world-model.test.mjs town-static.test.mjs town-render.test.mjs town-render-2d.test.mjs world-parity.test.mjs art-output.test.mjs` → PASS; `npm run perf:town` → within budgets.
- [ ] **Step 5:** Commit `Town: meeting room lot and interior`.

### Task 5: Desktop permission policy

**Files:** Create `desktop/media-permissions.mjs`, `desktop-permissions.test.mjs`. Modify `desktop/main.mjs`, `package.json` (`build.mac.extendInfo.NSMicrophoneUsageDescription = "TiroAgents uses the microphone only while you are in a meeting room and have chosen to join with your microphone."`).

**Interfaces — Produces:** `decidePermission({ permission, origin, isMainWindow, mediaTypes, appOrigin }) -> boolean`:
- microphone: Electron's media permission, `mediaTypes` exactly `['audio']`, `origin === appOrigin`, `isMainWindow` → true
- clipboard write (Electron's sanitized-write permission name): `origin === appOrigin` → true
- protected media playback (Electron's name for it): `origin === 'https://open.spotify.com'` → true
- everything else → false

Confirm the three exact permission strings against the installed Electron 43 typings (`node_modules/electron/electron.d.ts`) before writing them.

- [ ] **Step 1: Failing test** `desktop-permissions.test.mjs`: table of cases — audio from app origin main window ✔; `['audio','video']` ✘; `['video']` ✘; audio from `https://open.spotify.com` ✘; audio from a non-main window ✘; clipboard write app origin ✔ / other origin ✘; protected media from Spotify ✔ / from app origin ✘; `geolocation`, `notifications`, `openExternal`, `''`, `undefined` ✘.
- [ ] **Step 2:** `node --test desktop-permissions.test.mjs` → FAIL.
- [ ] **Step 3:** Implement the function; in `main.mjs` call `session.defaultSession.setPermissionRequestHandler` and `setPermissionCheckHandler` once at startup, both delegating to it (main window = the `office` BrowserWindow's `webContents`).
- [ ] **Step 4:** Test → PASS; add the file to the `test` script. Then run the app (`AGENT_OFFICE_PORT=4790` with a temp `USERPROFILE`/`APPDATA`, never the installed app's data) and confirm by hand: Copy invite link works, YouTube party music plays, Spotify party music plays, the island and the sign-in windows open. If one fails, add the narrowest allow rule for its origin, a test row, and a changelog note.
- [ ] **Step 5:** Commit `Desktop: explicit permission allow-list (microphone, clipboard write, Spotify playback)`.

### Task 6: Voice engine

**Files:** Create `public/meet-voice.js`, `meet-voice.test.mjs`. Modify `server.mjs` static allow-list so the file is served (follow how `party-music.js` is served and gated).

**Interfaces — Consumes:** `/api/party/rtc`, `/api/party/voice-config`, page event-stream `signal` messages, `view().voice`.
**Produces** (UMD-style like `party-music.js`, so Node can test the pure part):
- `MeetVoiceCore.shouldOffer(myId, otherId) -> boolean` — true when `myId < otherId` (string compare).
- `MeetVoiceCore.plan(myId, slotIds, connectedIds) -> { connect: string[], close: string[] }` — peers to open (slot holders that are not me and not connected) and to close (connected but no longer holders); empty lists when `myId` holds no slot.
- `MeetVoiceCore.nextState(state, event) -> state` for one peer: states `'new' | 'connecting' | 'connected' | 'restarting' | 'failed' | 'closed'`; events `'start' | 'connected' | 'timeout' | 'ice-failed' | 'restart-sent' | 'close'`. `timeout`/`ice-failed` from `connecting` → `restarting`; from `restarting` → `failed`; `close` from anything → `closed`.
- `MeetVoice.create({ api, onSignal, onState }) -> { join(mode: 'mic' | 'listen'), setMuted(bool), leave(), peers(), level(id) }`.
  - `join('mic')` in a page load where the user has not clicked yet must not call `getUserMedia`: the caller (Task 7) passes `'mic'` only from a click handler; re-entry uses `join('listen')` and upgrades on first unmute via `setMuted(false)`, which opens the device then.
  - `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`; on rejection or no device, fall back to listen and report `onState({ mic: 'listen', reason: 'denied' | 'no-device' })`.
  - Listen-only peers add a `recvonly` audio transceiver.
  - 10 s without `connected` → one ICE restart → `failed`; `onState` carries per-peer state for the room list.
  - `leave()` closes every connection, stops every local track, closes the `AudioContext`. Also wired to `pagehide`.
  - `level(id)` returns 0..1 from an `AnalyserNode` (local id included).

- [ ] **Step 1: Failing tests** `meet-voice.test.mjs`:

```js
test('shouldOffer: exactly one side of every pair offers', () => {
  assert.equal(C.shouldOffer('a1', 'b2'), true); assert.equal(C.shouldOffer('b2', 'a1'), false);
});
test('plan: connect to new holders, close departed ones, nothing without a slot', () => {
  assert.deepEqual(C.plan('me', ['me', 'x', 'y'], ['y', 'z']), { connect: ['x'], close: ['z'] });
  assert.deepEqual(C.plan('me', ['x', 'y'], ['x']), { connect: [], close: ['x'] });
});
test('nextState: one restart, then failed; close always wins', () => {
  let s = C.nextState('new', 'start'); assert.equal(s, 'connecting');
  s = C.nextState(s, 'timeout'); assert.equal(s, 'restarting');
  assert.equal(C.nextState(s, 'connected'), 'connected');
  assert.equal(C.nextState(s, 'ice-failed'), 'failed');
  for (const st of ['new', 'connecting', 'connected', 'restarting', 'failed']) assert.equal(C.nextState(st, 'close'), 'closed');
});
```

- [ ] **Step 2:** `node --test meet-voice.test.mjs` → FAIL.
- [ ] **Step 3:** Implement core, then the browser wiring. Trickle ICE (send each candidate as its own `rtc` message, `''` at the end).
- [ ] **Step 4:** Tests → PASS; add to the `test` script; `node --test town-static.test.mjs perf-sources.test.mjs` → PASS (new static file is listed where those tests require).
- [ ] **Step 5:** Commit `Meeting room: voice engine`.

### Task 7: Room UI

**Files:** Create `public/meet-room.js`, `meet-room.test.mjs`. Modify `public/Agent Office.html` (load both meet scripts in scene `meet`), `public/bg-music.js` and `public/party-music.js` (ducking hooks), `public/hud.js` if the indicator belongs there.

**Interfaces — Consumes:** `MeetVoice.create`, `view().voice`, `/api/party/avatar` (to publish `mic` and `hand`).
**Produces:**
- Consent card with the spec's exact copy and the three buttons; shown only when in a party, scene is `meet`, `voice.support === 'ok'`, and no choice exists yet this app run. The choice lives in `sessionStorage` under `meet.choice` (`'mic' | 'listen'`); nothing on disk. (If scene changes turn out to start a new session storage, keep the choice in the local server's memory behind `GET/POST /api/party/voice-choice` instead.)
- Re-entry: `choice === 'mic'` → join listen, avatar `mic: 'muted'`, toast `Muted. Press M to talk`; first unmute opens the mic.
- `voice.support === 'host-old'` → banner `The host needs TiroAgents 2.1 for voice`; no card.
- The party ending, being kicked, leaving the party, or losing the slot (`voice.mine` turns false) calls `voice.leave()` at once and removes the indicator; `entryAction` returns `'none'` when `inParty` is false. Test row: a snapshot with `inParty: false` after a joined state triggers leave.
- No slot → banner `Voice is full`; joins automatically when `voice.mine` turns true (as listen or muted per the choice; never opening the mic without a click).
- Room list rows: name + one of speaking / on / muted / listen only / `Can't connect to <name>: this network blocks direct calls`. Pure helper `MeetRoom.rowState({ mic, level, peer }) -> 'speaking' | 'on' | 'muted' | 'listen' | 'failed'` with speaking when `level > 0.08` and mic is `'on'`.
- Mute button and `M` key (ignored while typing in an input). Persistent indicator `In the meeting room · mic on|muted|listen only`.
- Music: on join, pause background music and call a new `PartyMusic.duck(true)` — YouTube and stream volume to 25%, Spotify paused locally; on leave `duck(false)` restores volume and re-syncs Spotify to the party position (reuse the module's existing seek-to-position logic).
- Relay setting: a small "Relay server (optional)" form in the Party panel posting to `/api/party/voice-config`.

- [ ] **Step 1: Failing tests** `meet-room.test.mjs`: `rowState` table (failed peer wins; listen; muted; on with level 0.02 → `'on'`; on with level 0.3 → `'speaking'`); `MeetRoom.entryAction({ inParty, support, mine, choice }) ->` `'none' | 'old-host' | 'full' | 'card' | 'rejoin-muted' | 'rejoin-listen'` table covering every row above. `party-music.test.mjs`: `duck(true)` then `duck(false)` on a Spotify source issues pause then a seek to the expected position and resume; on YouTube it issues volume 25 then 100.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test meet-room.test.mjs party-music.test.mjs bg-music.test.mjs hud.test.mjs` → PASS; add the new file to the `test` script.
- [ ] **Step 5:** Commit `Meeting room: consent card, room list, mute and music ducking`.

### Task 8: Reactions, raise hand and animations

**Files:** Modify `public/meet-room.js`, `public/office-world.js` (drawing over avatars in scene `meet`), `public/office-motion.js` if seat/sit logic lives there. Tests: `meet-room.test.mjs`, `office-motion.test.mjs`.

**Interfaces — Consumes:** `/api/party/emote`, `signal` messages of type `emote`, avatar `hand`.
**Produces:**
- Keys `1`–`6` and six buttons send `EMOTES[i]`; the reaction shows over the sender's avatar for 3000 ms for everyone in the room (the sender draws their own immediately). Pure helper `MeetRoom.activeEmotes(list, now) -> list` dropping entries older than 3000 ms and keeping at most one per person (the newest).
- `H` toggles raise hand: publishes avatar `hand: true`/absent; a hand icon over the avatar and in the room list.
- Sitting: an avatar standing on a seat piece draws the seated pose; speaking avatars bob with `level`.
- Door animation and chime on enter/leave; chime obeys the app's sound setting.
- Reduced motion, Power saver or Low preset: no bob, no pop animation, no door animation, no chime under reduced motion; static icons still appear.
- Sprites for reactions/hand are added to the existing atlas (GPU texture), not loaded as separate decoded images.

- [ ] **Step 1: Failing tests:** `activeEmotes` (expiry at exactly 3000 ms, newest-per-person); a motion-settings table asserting animations are off under each of the three conditions (use the helper the office already uses to read those settings).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test meet-room.test.mjs office-motion.test.mjs office-graphics.test.mjs perf.test.mjs` → PASS.
- [ ] **Step 5:** Commit `Meeting room: reactions, raise hand, sitting and entrance animations`.

### Task 9: Live check, docs and version

**Files:** Create `perf/meet-check.cjs`; modify `package.json` (`"check:meet": "electron perf/meet-check.cjs"`, version `2.1.0`), `package-lock.json`, `CHANGELOG.md`, `party/README.md`, the party page under `docs/`, the site privacy source (`site/tools/pages.mjs`) then `node site/tools/gen-docs.mjs`.

- [ ] **Step 1:** Write `perf/meet-check.cjs` modelled on `perf/hud-check.cjs`: start a party server on a free local port; launch two app instances with separate temp `USERPROFILE`/`APPDATA` and ports (4790, 4791) and Chromium switches `use-fake-device-for-media-stream` and `use-fake-ui-for-media-stream`; both join; both open `/#scene=meet`; instance A clicks **Join with microphone**, B clicks **Listen only**. Assert: A's row on B is `on` or `speaking` and B's `level(A) > 0`; B never called `getUserMedia`; A reloads the scene → joins muted with no capture until `M`; A leaves the scene → B's peer list is empty and A has no live tracks; a third fake member who never entered `meet` gets `ok:false` from `/rtc`. Exit non-zero on any failure.
- [ ] **Step 2:** `npm run check:meet` → all assertions pass. `npm run check:hud` → still passes.
- [ ] **Step 3:** Docs: privacy page, party doc and `party/README.md` state that voice is direct between apps, that people in the room and the public STUN servers can see your IP address, that nothing is recorded, how listen only works, and the optional relay setting. CHANGELOG `## 2.1.0` entry describing the room, the permission allow-list change and the 2.0 host message.
- [ ] **Step 4:** Bump both version files; `npm test` → all pass; `node --test site/site.test.mjs` → pass; `npm run perf:town` and the office-perf harness → within budgets.
- [ ] **Step 5:** Commit `2.1.0: meeting room with voice`. Do not tag, build installers or publish; release is a separate, user-approved step.
