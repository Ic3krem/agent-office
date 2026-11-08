# Host a TiroAgents party

**Easiest: host from the app.** In TiroAgents open **Party** and click **Host a party**. Your office becomes the main house of the town, you join automatically, and the panel shows the share link and the invite code with a Copy button. The first time, the app downloads Cloudflare's share-link program (`cloudflared` 2026.10.7, checked against its published SHA-256). The party lasts while your app is open.

The rest of this page is for hosting with Docker instead, for example to keep a party up while your PC's app is closed. A Docker party has no host in the town, so each player keeps their own house there and the others take the friend lots.

## Host (Windows)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Unzip `party-server.zip` (or use this `party` folder from the repository).
3. Right-click `host-party.ps1` and choose **Run with PowerShell**. Or run it from a terminal:
   `powershell -ExecutionPolicy Bypass -File host-party.ps1`
4. Wait for the script to print a **share link** (`https://….trycloudflare.com`) and an **invite code**. A ready-made message containing both is on your clipboard. Send it to your friends.
5. Join it yourself: in TiroAgents, open **Party**, paste the link and the code, and join.

Run the script again any time to see the link. Stop the party with `.\host-party.ps1 -Stop`.

- **The link:** it changes every time the party restarts, so send the new one.
- **The invite code:** it stays the same. It is kept in `.env` next to the script; delete that file for a new code.
- **The host key:** it is printed too. Keep it private; it is what removes people from the party.

**Mac or Linux:** run `docker compose up -d --build` in this folder, then `docker compose logs party` shows the link and the code.

## Friends

1. Install TiroAgents from the release page and start it.
2. Open **Party**, paste the link and the code from the host, choose a name, and join.

A share link cannot carry the live update stream, so after about 5 seconds the app switches to a slower fallback. Chat and presence still arrive, a little delayed. To test the fast path on the same network, use `http://<host's IP>:4880` instead of the link. Note that this shows your IP address to whoever you give it to.

## What others can see

Your office layout, costumes, avatar, your agents' names and states (working, idle, blocked and so on), and generic bubbles such as "Coding…". Never your tasks, prompts, commands, file paths or reports. The app strips everything else before anything leaves your machine, and the server drops any field it does not know.
