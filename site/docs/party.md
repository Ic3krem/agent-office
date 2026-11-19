# Party and the meeting room

Play together, and talk by voice in the meeting room: what others see and how listen only works.

(TiroAgents v2.1.0, 2026-11-20)

Play together: host or join a party from the **Party** panel (in the office ☰ menu or at the top right of the town). The host's office is the main house of the town and every guest's office stands on a friend lot. To host without the app, with Docker, see `party/README.md`.

## What others can see

Your office layout, costumes, avatar, your agents' names and states (working, idle, blocked and so on), and generic bubbles such as "Coding…". Never your tasks, prompts, commands, file paths or reports. The app strips everything else before anything leaves your machine, and the party server drops any field it does not know.

## The meeting room (2.1)

In a party, walk to the **Meeting room** lot in the town and go in. People in the room talk by voice. The first time in a session a card asks how to join:

- **Join with microphone.** The app asks for your microphone (only now, and only for audio). Press **M** or the mute button to mute and unmute.
- **Listen only.** You hear everyone, and the app never opens your microphone. Press **M** or **Turn on microphone** later if you want to talk; that is the first moment it asks for the microphone.
- **Leave** goes back to the town.

Coming back into the room in the same session skips the card: if you chose the microphone you come back **muted**, and the microphone is not opened until you press M. Reactions are keys **1** to **6** (or the buttons), **H** raises your hand; others see them over your avatar for about 3 seconds. Up to 8 people have voice; the next one sees "Voice is full". A host on TiroAgents 2.0 cannot carry voice: the room says "The host needs TiroAgents 2.1 for voice".

**Privacy.** Voice goes **directly between the apps** in the room (WebRTC, encrypted). The party server only passes the short connection setup messages between the people in the room; it never receives the audio. **Nothing is recorded.** To find a direct route, each app asks public STUN servers (`stun.l.google.com` and `stun.cloudflare.com`) for its public address, so **the people in the room and those STUN servers can see your IP address**. If you do not want that, do not enter the meeting room.

**Optional relay.** Some networks block direct calls; the room then says "Can't connect to …". In the Party panel, **Relay server (optional)** takes a TURN server address (`turn:` or `turns:`), user name and password. It is kept on this PC only (the password is never shown again or sent to the party) and is used for your calls; the relay operator then sees your IP address and carries the encrypted audio.

