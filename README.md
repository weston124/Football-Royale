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

## Put it online for free (Render.com)
1. Push this folder to a GitHub repository.
2. On https://render.com, create a **New → Web Service** from that repo.
3. Build command: `npm install`. Start command: `npm start`. Instance type: **Free**.
4. Under **Environment**, add `ADMIN_PASSWORD` with a secret only you know.
5. Share the `https://<your-app>.onrender.com` link with friends!

Notes on the free plan: the server falls asleep after ~15 minutes with nobody playing
and takes about a minute to wake up. News and scheduled events are saved in `data/admin.json`,
which the free plan erases when the app restarts or redeploys.

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
Built with [three.js](https://threejs.org) (MIT) and [ws](https://github.com/websockets/ws) (MIT).
All art is drawn from code, and all sounds are generated in the browser. No outside assets.
The architecture was inspired by open-source browser shooters such as Neon Doom Pit (MIT)
and Suroi (GPL-3.0). No code was copied from them.
