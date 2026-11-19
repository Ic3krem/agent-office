# Meeting room with voice (TiroAgents 2.1)

Date: 2026-11-18. Branch: `feature/world`. Ships as 2.1.0.

## Intent

TiroAgents should be more fun and interactive for people in a party, in the way virtual-office apps are: you walk
somewhere and can talk to whoever is there. The first step is a **meeting room** in the town. Walking in asks for your
microphone; everyone inside hears each other; walking out disconnects you.

The project is open source and must stay **free to run**: no paid service, no account, no server the maintainer pays for.

## Goals

- A meeting room building in the town that any party member can walk into.
- On entering while in a party, the app asks before using the microphone. Nothing is captured before the user clicks.
- Everyone in the room hears everyone else, with echo cancellation and noise suppression.
- Mute/unmute, a "listen only" choice, and a visible sign of who is speaking and who is muted.
- Leaving the room (or the party ending, or being kicked) stops the microphone and closes every connection.
- Works with both ways of hosting a party: the in-app "Host a party" (share link) and the Docker party server.

## Non-goals

- Video, screen sharing, recording, transcription.
- Voice anywhere else (walking near someone in the town, the game hall, offices).
- A relay (TURN) server run by the project. A user-supplied one can be configured; none is shipped.
- Changing text chat (it stays party-wide).
- Larger parties or changes to the party member cap.

## Anti-goals (a failure even if it works)

- The microphone is on without an explicit click, or stays on after leaving the room.
- Audio passes through, or is stored by, any server.
- Anything that needs a paid plan, an API key or an account.
- The signalling route becomes a way to push arbitrary data or text between members (it must stay size-capped,
  rate-limited, typed, and never stored).

## Constraints (how things work today)

- The app's page talks only to its own local server (`server.mjs`, 127.0.0.1). That server holds the party connection
  (`party-client.mjs`) and passes things to the party server (`party/server.mjs`), which relays to other members over
  SSE, or long polling when a share link cannot carry a stream.
- Every message crossing the party goes through the cleaners in `party/protocol.mjs` on both sides. The file's header
  states exactly what may cross; that statement must stay true and be extended.
- An avatar's `room` is one of `home`, `lounge`, `town`, `kain`, `games`, `office:<id>` (`cleanAvatar`).
- Town lots are `home`, `kain`, `games`, `friend-1..3` (`public/town-map.js`); `kain` and `games` are walk-in scenes
  (`/#scene=kain`, `/#scene=games`).
- The page CSP is `connect-src 'self'`. The desktop shell sets no permission handler today, so Electron grants every
  permission request by default.
- Every `/api` write needs the session nonce.
- Perf budgets are enforced by `npm run perf:town` and the office-perf harness.
- The party server is zero-dependency Node; keep it that way.
- Memory: if the new room or its art presses on the system-memory budget, prefer the GPU (textures held in VRAM, not
  as decoded copies in RAM), as the user asked. Low preset and the Canvas2D fallback must still work without a GPU.

## Approaches considered

1. **Direct calls between the apps (chosen).** Each app in the room opens a WebRTC audio connection to each other app.
   The party server only passes the short setup messages. Free, no new server or account, works with share-link hosting.
   Cost: on some strict networks a pair cannot connect without a relay; people in the room can learn each other's IP
   address.
2. **A voice server bundled with the party server (LiveKit).** More reliable and scales to big rooms, but the host must
   run Docker and open UDP ports, and share-link hosting cannot carry it. Rejected: it breaks the simple hosting path.
3. **A hosted voice service.** Most reliable, but needs an account, a key and paid minutes. Rejected: not free.

The user chose 1 because the project is meant to be as free as possible. A relay can be added later through settings
without redesigning the room.

## Design

### The room

- New lot `meet` ("Meeting room") in the town, entered like the game hall: scene `/#scene=meet`, avatar room `meet`.
- Interior: one room with a table and seats. Players in the room see each other's avatars, as in the game hall.
- It can be entered when not in a party; then it is just a room and no microphone prompt appears.

### Asking for the microphone

On entering while in a party, a card appears before anything is captured:

```
Meeting room
People here talk by voice. Your app connects directly to theirs,
so they can see your IP address. No audio is recorded or sent to a server.

[ Join with microphone ]   [ Listen only ]   [ Leave ]
```

(Card wording corrected 2026-11-19: setup data does pass the party server.)

- **Join with microphone** calls `getUserMedia` (audio only; echo cancellation, noise suppression, auto gain on).
  If the OS or the user refuses, the app falls back to listen only and says so.
- **Listen only** connects without capturing anything.
- The card shows once per app run. After that, entering never captures on its own: someone who chose the microphone
  earlier re-enters **muted, with the device not yet opened**, and a toast says "Muted. Press M to talk"; the first
  unmute opens the microphone. Someone who chose listen only re-enters listening. The choice is kept in memory for the
  app run only, never on disk. (Maintainer's call: it keeps "no microphone without a click" true on every entry.)

### Voice

- WebRTC, audio only, one connection per pair (a mesh). The room carries voice for **up to 8 people**; a ninth can
  enter and see the room but gets "Voice is full" and no audio. (Maintainer's call: 8 keeps every app at 7 audio
  connections at most.)
- Who the 8 are: **first come, first served by when they entered the room**, decided by the party server. The server
  records the time a member's room becomes `meet`, publishes each member's voice slot (`voice: true | false`) with the
  avatar, and relays `rtc` only between members who hold a slot. Listen-only people hold a slot (they are connections
  too). When someone leaves, the longest-waiting person without a slot gets it automatically and connects. Nobody
  already talking is ever cut off by a newcomer. (Maintainer's call.)
- Who offers: of any two members in the room, the one with the smaller member id sends the offer. No glare handling
  needed beyond that.
- ICE servers: public STUN only by default (`stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`). Party
  settings get an optional "Relay server" (TURN URL, user, password) kept on the user's own machine; it is used for
  that user's connections only and is never sent to the party.
- If a pair cannot connect (ICE fails, or 10 s without connecting), try one ICE restart, then show "Can't connect to
  <name>: this network blocks direct calls" on that person in the room list. Other pairs are unaffected.

### Signalling (the only new thing that crosses the party)

- New message type `rtc`: `{ to: <member id>, kind: 'offer' | 'answer' | 'ice', data: <string> }`.
  `data` is capped (SDP 8 KB, ICE candidate 512 bytes) and must match the shape of an SDP or candidate line set; the
  cleaner (`cleanRtc`) rejects anything else.
- Path: page → `POST /api/party/rtc` (nonce) → `partyClient.rtc()` → party server `POST /rtc` → delivered only to
  the named member through their event stream or poll queue → their local server → their page.
- Server rules: relay only when sender and recipient both have `room === 'meet'`; rate-limit per member; never store
  (not in chat history, not in `hello`); drop if the recipient is gone.
- `cleanAvatar` gains `room: 'meet'` and a `mic` field: `'on' | 'muted' | 'listen'` (absent outside the room), so
  others can draw the right icon.
- `protocol.mjs` header is updated to list connection setup data (SDP and ICE candidates, which contain IP addresses)
  as something that crosses, to the addressed member only.
- A newer app on an older party server gets 404 from `/rtc`: the room says "The host needs TiroAgents 2.1 for voice".

### In the room

- Room list with each person's state: speaking ring (from an `AnalyserNode` level, local and remote), muted, listen
  only, can't connect.
- Mute button and the `M` key. Mute disables the track (`enabled = false`); it does not release the device.
- A persistent "In the meeting room · mic on/muted" indicator while connected.
- Background music pauses while in the room. Party music from YouTube or a stream keeps playing at reduced volume.
  Spotify's embed has no volume control, so it is paused locally in the room and re-synced to the party's position on
  leaving. (Maintainer's call.)
- Leaving the scene, leaving the party, the party ending, being kicked, or the window closing: close every peer
  connection and stop all tracks, so the OS microphone indicator goes off. Hiding or minimising the window does not
  disconnect (it is a call).

### Animations and fun in the room (added at approval; the user asked for animations or fun activities)

Maintainer's calls, kept small so voice ships first:

- **Sitting:** walking onto a seat plays a sit-down animation; the avatar stays seated until it moves.
- **Speaking:** the speaking ring pulses with the voice level and the avatar bobs slightly while talking.
- **Reactions:** six fixed reactions (wave, clap, laugh, heart, thumbs up, party popper) on keys 1-6 and as buttons.
  A reaction pops above the avatar with a short animation for about 3 seconds, for everyone in the room, including
  listen-only people. Wire format: `{ emote: <index 0-5> }` on the avatar path, cleaned to the fixed list (like
  `BUBBLES`), rate-limited, never stored. No free text.
- **Raise hand:** a toggle (key `H`) that shows a hand above the avatar and in the room list until lowered.
- **Entrance:** a small door-open animation and chime when someone enters or leaves (chime respects the app's sound
  settings and is skipped under reduced motion).
- All animation honours reduced motion, Power saver and the Low preset (static icons instead), and stays inside the
  existing perf budgets. Sprites go to the GPU as textures.

Games inside the meeting room (for example a quick poll or icebreaker) are a later project; the game hall keeps the
existing games.

### Desktop shell

- Add a permission request handler and a permission check handler on the default session with a short allow-list,
  **denying everything else**:
  - microphone (`media`, audio only): the app's own origin, main window only;
  - clipboard write (the invite-link Copy button): the app's own origin;
  - protected media playback (the Spotify party-music embed): `https://open.spotify.com` only.
  This tightens today's allow-all default. The builder confirms the exact Electron permission names for the installed
  Electron version, and checks by running the app that Spotify party music, YouTube party music, Copy invite link, the
  sign-in windows and the island still work; anything else found to need a permission is added to the list for its own
  origin only and noted in the changelog.
- macOS: add `NSMicrophoneUsageDescription` to the build config, and the audio-input entitlement if an entitlements
  file exists.
- CSP: no change expected (WebRTC peer connections are not governed by `connect-src`); the live check below proves it.

### Privacy and docs

- `site` privacy page, `docs/` party page and `party/README.md` say: voice is direct between apps, peers and the
  public STUN servers see your IP address, nothing is recorded, and how to use listen only.
- CHANGELOG entry for 2.1.0.

## Testing

- Unit: `cleanRtc`, `cleanAvatar` (`meet`, `mic`), and the server relay rules (both in room, addressed member only,
  size caps, rate limit, nothing stored, old-server 404 handling).
- Live check in the style of `npm run check:hud`: two app instances (temp profiles, separate ports) join one local
  party, enter the room with Chromium's fake microphone flags, and each asserts a connected peer with incoming audio
  level above zero; then one leaves and the other sees the connection closed and the track stopped.
- Permission handler: a test that non-audio and foreign-origin requests are denied.
- Existing suites and perf budgets still pass.

## Left to the builder

- How the `meet` lot looks and where it sits on the town map (new art through `npm run art`, or a re-signed variant of
  an existing building if new art does not fit the budgets), and the interior layout.
- How party events reach the page today and the matching way to deliver `rtc` messages to it.
- Module layout for the client voice code (expected: one new file in `public/`, in the style of `party-music.js`).
- Exact rate limits and timeouts, within the rules above.
- Whether the long-poll fallback needs a shorter poll interval while a call is being set up.
