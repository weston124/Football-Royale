# Football Royale: Launch Report

**Status: ready to launch.** All 42 automated tests pass. I ran end-to-end QA in desktop Chrome and in iPad and iPhone
emulation across sign-up, Locker Room, Item Shop, a full private match (blimp → skydive → parachute), Party Island,
admin panel and Global Party, with zero console errors.

Five engineers worked in parallel overnight. I reviewed and merged each branch, resolved conflicts and fixed the
integration bugs.

## What shipped tonight

| Team | Highlights |
|---|---|
| **Mobile** | Full touch controls for iPad and phones: joystick, drag to look, FIRE/AIM/JUMP/RELOAD/USE, tappable hotbar, build and emote buttons, gentle aim assist. Phone and tablet layouts for every screen, "rotate your device" prompt, lighter rendering on mobile. |
| **Gameplay QA + Bots** | **11 bugs fixed.** The worst: reloads and heals could never finish, which stalled late circles; buying an item crashed the server. Bots rewritten with pathfinding, cover, healing, storm rotation and building in Build mode, and they're fair to kids (Easy bots never shoot parachuters, and no ganging up). Matches run **~9–10 minutes**. Weapons are balanced: no weapon gets more than 33% of kills. |
| **Performance + Netcode** | Bandwidth per player **51 → 7 KB/s**. Draw calls in a crowd **915 → 136**, and **206 → ~50** in a normal view. Memory **73 → 21 MB**. Three detail levels for players; Auto/Low/Medium/High graphics with automatic resolution scaling. No memory leaks. |
| **Launch Ops + Security** | Crash-safe saving with hourly backups, security headers and CSP, connection, rate and flood limits, Brotli/gzip and caching, graceful restarts. Share-preview image (Open Graph and Twitter), home-screen app install (PWA), Privacy/Terms/Credits pages, account deletion, a Dockerfile and a Render configuration with a persistent disk. 0 npm vulnerabilities. |
| **Game Feel + UX** | Redesigned Locker Room with a big QUICK PLAY button, one-tap INVITE FRIENDS, first-match coach tips, settings (volume, sensitivity, FOV, invert, graphics, FPS counter). Hit, headshot and elimination sounds, screen shake, footsteps, low-health heartbeat, callouts ("DOUBLE TACKLE!", "TOP 10"), victory slow-motion with confetti. New results screen with PLAY AGAIN and a **Share my result** poster. Menu music. |
| **Integration (me)** | Merged all 5 branches. Footsteps restored inside the new player renderer. Coach tips now use touch wording on tablets and sit clear of the joystick. The storm wall stays hidden until it starts closing. The admin button no longer covers the shop. The results screen fits phones held sideways. |

## To go live (about 15 minutes; a GitHub repository is needed)
1. Create an empty GitHub repository, upload this project (or give its name to Claude, who will push it).
2. On Render.com: **New → Blueprint** → pick the repository. `render.yaml` sets everything up: Starter plan, a
   1 GB persistent disk for accounts, health check.
3. When Render asks, set these:
   - `ADMIN_PASSWORD`: 16+ characters, private
   - `CONTACT_EMAIL`: a parent's address for the privacy page
   - `ADMIN_USERS`: already `LONGHORNS 1`
4. Optional: add a custom domain and set `PUBLIC_URL` so share previews use it.
5. Sign up in the game as **LONGHORNS 1**; you get the 👑 Admin menu automatically.

**Cost:** about $7/month for Render Starter + disk. The free plan works, but it **erases all accounts and Ball Bucks
on every restart**, so it isn't suitable for launch.

## Decisions for the CEO
1. **Kids' privacy (COPPA):** sign-up uses an "I'm 13+ or my parent said OK" checkbox, and emails are stored only as
   a one-way hash. This isn't formal verifiable parental consent. I recommend a quick legal review before marketing
   to under-13s.
2. **Real-money Ball Bucks** are still switched off (the $1 = 100 packs show as "Coming soon"). Turning them on needs
   a Stripe account in an adult's name.
3. **Difficulty:** the Normal and Hard bot numbers come from simulated kid players. Tune them after the first real
   playtest (`shared/constants.js`).

## Known limitations / watch list
- Everything was tested on emulated devices with software graphics. **Play one match on a real iPad and a real
  laptop** to confirm frame rate, sound and aim assist feel.
- Rare: a player walking up a ramp under a doorway can clip into it for a moment. During simulation, one build-mode
  match didn't send its end message; it couldn't be reproduced.
- If Render puts a proxy in front, set `CLIENT_IP_HEADER` so per-player rate limits can't be dodged.
- Never delete `email-pepper.key` on the data disk, or logging in by email stops working (usernames still work).

## Where things are
- Code: this repository (39 commits, plus each engineer's branch preserved). Architecture: `docs/ARCHITECTURE.md`.
- Tests: `npm test`. Simulation tools: `tools/sim.js` (full matches), `tools/netmeter.js`, `tools/serverbench.js`.
