# 🏈 Football Royale

An original, free, web-based **multiplayer first-person battle royale**: 75 football players
drop onto the Giant Sports City, and the last team standing wins.
Friends just open a link. Nothing to download.

## Features
- **75-player matches** (bots fill the empty spots: Easy / Normal / Hard)
- **Team Blimp** drop, sky-diving and parachutes
- **Overtime Storm** that shrinks in 7 phases
- **Weapons in 5 rarities**: Rookie Pistol, Blitz SMG, Linebacker Rifle, Sack Shotgun,
  Hail Mary Sniper, plus sports specials: **Pigskin Cannon** and **Whistle Grenade**
- Healing: Tape Roll, Trainer's Kit, Padding Pack (shield)
- **Build mode** (walls, floors, ramps made of Turf) or **No-Build mode**
- **Skins**: 9 original teams (some unlock with wins and eliminations) plus a custom jersey editor
- **Emotes**: Gridiron Shuffle, Touchdown Spike, Victory Dance, Helmet Salute, Ref Signals
- **Squads**: make a party with a code. Up to 4 friends drop into the same match as teammates.
- **Private rooms** with a 4-letter code and an invite link
- **Accounts**: sign up with email (stored only as a one-way hash, so nobody can read it),
  username (public) and password (scrypt hash). Ball Bucks and items follow your account.
- **👑 In-game admin drop-down** for admin accounts: parties, messages and gifts without leaving the game
- **Realistic players** built on the MakeHuman base body (CC0) with a skeleton, loose jersey over pads,
  tinted visor, gloves and cleats
- **Longhorn Item Shop** and **Ball Bucks** (earned by playing; real-money buying is turned off)
- **Admin panel** at `/admin`: post updates, message every player, schedule parties,
  and the **GLOBAL PARTY 🎉** button (Party Royale with double loot, or Party Island hangout)

## Run it on your computer
You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
ADMIN_PASSWORD=pick-a-secret npm start
```

Open http://localhost:3000 to play and http://localhost:3000/admin for the admin panel.
(If you don't set `ADMIN_PASSWORD`, a random one is printed in the terminal.)

## Put it online (Render.com)
The repo has a `render.yaml` blueprint: on https://render.com choose **New → Blueprint** and pick this repository.

**Player accounts are files on disk**, so the server needs a **persistent disk**. The blueprint uses the paid
**Starter** plan with a 1 GB disk mounted at `/var/data` (`FR_DATA_DIR=/var/data`).
The **free plan has no disk: every deploy, restart or sleep erases all accounts**. It's fine for a quick try-out
(there's a commented free-plan block at the bottom of `render.yaml`), never for real players.

### Launch checklist
1. **Disk**: the service shows a disk mounted at `/var/data`, and `FR_DATA_DIR` is `/var/data`.
   After the first sign-up, check the Render shell: `ls /var/data` shows `accounts.json` and `email-pepper.key`.
2. **`ADMIN_PASSWORD`**: 16+ random characters (a password manager is best). It unlocks `/admin`.
3. **`ADMIN_USERS`**: your in-game username(s), comma separated, for the 👑 Admin drop-down. Sign up with that
   username right after launch so nobody else takes it.
4. **`CONTACT_EMAIL`**: an inbox you read. It is shown on `/privacy` and `/terms` so parents can reach you
   (privacy laws for kids expect this).
5. **Custom domain**: Render → Settings → Custom Domains → add `play.yourdomain.com`, create the CNAME it shows,
   wait for the certificate, then set `PUBLIC_URL=https://play.yourdomain.com` so share previews use it.
6. **Smoke test**: open the site, sign up, play a match, open `/admin`, post an update, check `/privacy`.
   Paste the link into a chat app to see the share preview (`/og.png`).
7. **Back up**: `accounts.json.bak-1…5` (hourly) sit next to the data. Now and then, download
   `/var/data` from the Render shell (or enable Render disk snapshots) and keep a copy somewhere else.
   **Never lose `email-pepper.key`**: without it, logging in with an email stops working (usernames still work).

### Settings
| Variable | What it does |
|---|---|
| `ADMIN_PASSWORD` | Password for `/admin` (random one printed at startup if missing) |
| `ADMIN_USERS` | Usernames that get the in-game admin menu |
| `FR_DATA_DIR` | Folder for `accounts.json`, `admin.json`, backups and `email-pepper.key` (default `./data`) |
| `CONTACT_EMAIL` | Contact address shown on the privacy and terms pages |
| `PUBLIC_URL` | Your public address, used for share-preview links (default: the request's host) |
| `CLIENT_IP_HEADER` | Header with the player's real IP that players can't fake, e.g. `cf-connecting-ip` (default: first `X-Forwarded-For`) |
| `ALLOWED_ORIGINS` | Extra sites allowed to open the game's WebSocket (same site and localhost always are) |
| `MAX_CONN_PER_IP`, `MAX_CONNECTIONS`, `MAX_ROOMS`, `SIGNUPS_PER_IP_HOUR` | Abuse limits (30, 3000, 150, 30) |

### Safety built in
- Saves are atomic (temp file → fsync → rename) with hourly rolling backups. A damaged file is kept as
  `*.corrupt-<time>` and the newest good backup is loaded; the log shows a loud `DATA WARNING`.
- On deploy (SIGTERM) the server saves everything, tells players it's restarting and closes cleanly;
  the game reconnects by itself.
- Security headers with a strict Content-Security-Policy, WebSocket origin check, per-IP connection,
  sign-in, sign-up and room limits, message size/rate limits, and admin-password lockouts.
- Players can delete their account on `/privacy`; admins can delete one by username in `/admin`.

### Docker (any host)
```bash
docker build -t football-royale .
docker run -p 3000:3000 -e ADMIN_PASSWORD=change-me -e CONTACT_EMAIL=you@example.com -v fr-data:/data football-royale
```
The image runs as a non-root user, keeps data in the `/data` volume and has a health check on `/healthz`.

## Tests
```bash
npm test
```

## How the code is organized
| Folder | What's inside |
|---|---|
| `shared/` | Code used by both the server and the browser: map generator, physics, weapons, skins, numbers |
| `server/` | The game server (`index.js`), match rules (`match.js`), bots (`bots.js`), admin tools (`admin.js`) |
| `client/` | The web page: menu, 3D game (`js/game.js`), models, world, sounds, HUD, and `admin.html` |
| `test/` | Automated tests |

See `DESIGN_PROMPT.md` for the full design and ideas for version 2.

## Credits
The realistic human body, skeleton and skin weights come from the MakeHuman project
(https://github.com/makehumancommunity/makehuman, assets released as CC0 1.0).
`tools/build_human.py` converts them into `client/assets/human.*`.

Built with [three.js](https://threejs.org) (MIT) and [ws](https://github.com/websockets/ws) (MIT).
See also the in-game `/credits` page. Icons: `tools/make_icons.py`; share image: `tools/make_og.cjs`.
All art is drawn from code, and all sounds are generated in the browser. No outside assets.
The architecture was inspired by open-source browser shooters such as Neon Doom Pit (MIT)
and Suroi (GPL-3.0). No code was copied from them.
