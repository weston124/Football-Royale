# Football Royale: Engineering Guide

An original web-based multiplayer first-person battle royale (75 players, bots fill empty slots)
for kids aged ~10-14. Everyone is an American football player. Desktop browsers today, mobile next.
Node 22, no build step: the server serves static ES modules; three.js comes from `node_modules`
through an import map in `client/index.html`.

## Run it
```bash
npm install
ADMIN_PASSWORD=testpass ADMIN_USERS="LONGHORNS 1" PORT=3000 npm start   # http://localhost:3000  (admin: /admin)
npm test                     # all tests (gameplay test spawns its own server on TEST_PORT, default 3999)
FR_DATA_DIR=/tmp/x npm start  # keep accounts/news data somewhere else
```
Chromium + Playwright are pre-installed (`require('playwright')`, launch with
`args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']` for WebGL).
Software rendering is slow (~5 fps); don't judge performance by it. A new browser session must
**sign up** first (Sign up tab: email, username, password, age checkbox) before the menu appears.
`window.__fr.game` exposes the running Game object for tests.

## Layout
| Path | What |
|---|---|
| `shared/constants.js` | Tick rate, map size, player physics, storm phases, build/bot settings |
| `shared/physics.js` | `World` spatial hash of AABB boxes, `stepPlayer`, `stepFalling`, `raycastWorld`, `rayPlayer`, `pieceBox` (build pieces) |
| `shared/map.js` | Seeded generator for the Giant Sports City (boxes, decor, trees, loot spots, chests, POIs) |
| `shared/weapons.js` | Weapons (5 rarities), consumables, damage |
| `shared/skins.js` | Outfit presets, Longhorn Item Shop, emotes, Ball Bucks rewards, `sanitizeSkin` |
| `server/index.js` | HTTP static server, WebSocket hub, rooms, friend squads, admin hub actions |
| `server/match.js` | One match: authoritative rules (movement validation, hitscan w/ lag compensation, projectiles, loot, storm, building, death, win, rewards) |
| `server/bots.js` | Bot AI |
| `server/accounts.js` | Accounts: username (ALL CAPS), email stored only as HMAC hash, scrypt passwords, sessions, Ball Bucks |
| `server/admin.js` | `/admin` panel API (password `ADMIN_PASSWORD`), news, broadcasts, scheduled parties |
| `client/index.html`, `client/css/style.css` | All screens: sign-in, Locker Room menu, lobby, HUD, shop, overlays |
| `client/js/main.js` | Menu/Locker Room, auth, shop, squads, admin drop-down, party popups, starts `Game` |
| `client/js/game.js` | In-match client: input, local movement prediction, interpolation, shooting, building, emotes, camera, HUD updates |
| `client/js/human.js` | Realistic skinned player (MakeHuman CC0 body in `client/assets/human*.{json,bin}`), uniform painting, helmet, hair, pads |
| `client/js/models.js` | `createPlayer` (wraps human.js), `animatePlayer` (procedural animation for all poses/emotes), weapons, loot, blimp |
| `client/js/world.js` | Builds the 3D city from the map; minimap image |
| `client/js/menuScene.js` | Animated stadium home-screen background |
| `client/js/hud.js`, `client/js/audio.js` | HUD helpers; Web Audio procedural sounds + party music |
| `client/admin.html` | Admin web panel |
| `tools/build_human.py` | Converts MakeHuman CC0 data into `client/assets/human*.{json,bin}` |

## Network protocol (JSON over `/ws`)
Client → server: `hello{token,skin}`, `signup`, `login`, `logout`, `join{create|room|mode}`, `start`, `leave`,
`in{x,y,z,yaw,pitch,em,ph}` (20 Hz), `jump`, `deploy`, `fire{aim,dirs,rt}`, `reload`, `slot{i}`, `pickup{id}`,
`open{id}`, `drop`, `build{k,gx,gy,gz,r}`, `buy{item}`, `party_*`, `admin{action}`.
Server → client: `auth`, `auth_needed`, `profile`, `welcome`, `lobby`, `start`, `s` (20 Hz snapshot: `ps` player
array, `ev` events, `zn` zone, `me` private state, `pe` personal events), `end`, `closed`, `reward`, `bc`, `party_time`, `error`.

## Rules every change must follow
- **Original content only.** No Fortnite/Epic, NFL, NCAA or brand names, logos, likenesses or assets. No real people.
- Kid audience: no blood/gore, no chat with strangers, keep privacy protections (emails never shown or stored readably).
- Server stays authoritative. Never trust client numbers for damage, loot, Ball Bucks.
- Keep `npm test` green; add tests for new server rules.
- Commit with a clear message ending with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015QgzwJDeVWyFe7Ny1hQxci`

## Balance notes
Measured with the headless simulator (`node tools/sim.js [n] [nobuild|build|mixed] [easy|normal|hard] [normal|partyRoyale]`,
fake clock, 75 players, invariant checks; `BRAIN=bot` drives the human with a kid-like skill profile, `HUMANS=2 SQUAD=1`
for squads). `tools/wsplay.js` plays a real match over WebSockets; `tools/bench.js` measures tick CPU.

**Storm** (`ZONE_PHASES`): starts 25 s after takeoff, 8 phases, full close at ~11.5 min.
| phase | wait | shrink | radius | dps |
|---|---|---|---|---|
| 1 | 90 | 60 | 360 | 1 |
| 2 | 60 | 50 | 220 | 1 |
| 3 | 50 | 45 | 130 | 2 |
| 4 | 45 | 40 | 75 | 4 |
| 5 | 35 | 35 | 40 | 6 |
| 6 | 30 | 30 | 18 | 8 |
| 7 | 20 | 25 | 6 | 10 |
| 8 | 15 | 30 | 0 | 14 |

**Weapons** (Common damage × rate = DPS; rarity ×1.00–1.27): Pistol 23×5.5 (126), SMG 14×11 (154, 80 m),
Rifle 27×5 (135, 200 m), Shotgun 9 × 9 pellets, 1 shot/s (81 point-blank, falls off past 8 m), Sniper 82 (head ×2;
only a Legendary body shot one-shots 100 hp), Pigskin Cannon 70 splash, Whistle Grenade 70 splash.
Floor loot weights: pistol 3.2, smg 3, shotgun 3, rifle 2.6, sniper 1, pigskin 0.8. Rarity floor 42/30/17/8/3 %,
bags 10/30/32/20/8 %. ~245 floor spots + 34 bags for 75 players. Kills by weapon (Normal, 6 matches, 444 kills): SMG 33%,
rifle 28%, shotgun 26%, pistol 6%, explosives/tackle/sniper 7% — no single gun dominates (median fight 13 m).

**Bots** (`BOT_DIFFICULTY`, `BOT_VS_BOT` in `shared/constants.js`): difficulty only changes how bots treat
*humans* (aim wobble 0.19/0.15/0.095 rad, reaction 1.4/1.0/0.65 s, fire rate ×0.4/0.5/0.7, sight 50/70/90 m,
max 1/2/2 bots on one human at range, Easy never shoots parachuters). Bot-vs-bot fights always use `BOT_VS_BOT`
so pacing is the same at every difficulty. Aim settles over the first 1.4–3 s of a fight; bots have a field of
view and can't see through tree leaves.

**Results** (fast-forward sims, 10–12 matches each, kid-profile human):
- Match length: 7.5–10.2 min, typically ~9–10 min (Normal); ~20 players dead in the first 2 minutes (hot drops),
  5–10 alive entering the last circles.
- Human placement (kid profile): Easy wins ~80% of matches; Normal median ~15–25th with 25–40% wins; Hard median ~45th, rare wins.
  The kid profile is a guess at an average 10–12 year old (`KID` in `tools/sim.js`); re-tune with real playtests.
- Server CPU, `simulate()` with 75 players on a loaded 4-core box: avg 0.2 ms/tick whole match, 0.4–0.5 ms/tick
  in the first 3 minutes (p99 ~5–7 ms while everyone lands and plans paths; ≤6 path searches per tick).
  Snapshot encoding is not included.
