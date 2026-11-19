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
| `client/js/human.js` | Realistic skinned player (MakeHuman CC0 body in `client/assets/human*.{json,bin}`), uniform painting, helmet, hair, pads. Accessories are baked into a few skinned meshes with shared materials; mid/crowd LOD bodies are decimated from the body at load time |
| `client/js/models.js` | `createPlayer` (wraps human.js), `animatePlayer` (procedural animation for all poses/emotes), weapons/loot/chest props (baked, one vertex-colored geometry each), blimp |
| `client/js/players.js` | Draws other players: full detail for the closest few, decimated `mid` model, one instanced draw call for the far crowd, frustum culling, instanced blob shadows |
| `client/js/instanced.js` | Instanced floor loot and equipment bags |
| `client/js/quality.js` | Graphics presets Low/Medium/High/Auto + dynamic resolution (see below) |
| `shared/netcodec.js` | Snapshot player encoding (delta + quantization) and interest-management bands, used by server, client and tests |
| `client/js/world.js` | Builds the 3D city from the map; minimap image |
| `client/js/menuScene.js` | Animated stadium home-screen background |
| `client/js/hud.js`, `client/js/audio.js` | HUD helpers; Web Audio procedural sounds + party music |
| `client/admin.html` | Admin web panel |
| `tools/build_human.py` | Converts MakeHuman CC0 data into `client/assets/human*.{json,bin}` |
| `tools/netmeter.js`, `tools/serverbench.js` | KB/s per client (headless ws client); server CPU per tick with N full matches |
| `tools/rendermeter.js`, `tools/lodstats.js`, `tools/lodshot.js` | Playwright: draw calls/triangles/GPU memory (incl. a 74-player crowd and spawn/despawn leak check), triangles per LOD, LOD screenshot |

## Network protocol (JSON over `/ws`)
Client → server: `hello{token,skin}`, `signup`, `login`, `logout`, `join{create|room|mode}`, `start`, `leave`,
`in{x,y,z,yaw,pitch,em,ph}` (20 Hz), `jump`, `deploy`, `fire{aim,dirs,rt}`, `reload`, `slot{i}`, `pickup{id}`,
`open{id}`, `drop`, `build{k,gx,gy,gz,r}`, `buy{item}`, `spec{id}` (dead player: who they spectate), `party_*`, `admin{action}`.
Server → client: `auth`, `auth_needed`, `profile`, `welcome`, `lobby`, `start`, `s` (20 Hz snapshot: `ps` player
entries, `pg` players to forget, `ev` events, `zn` zone, `me` private state, `pe` personal events), `end`, `closed`, `reward`, `bc`, `party_time`, `error`.

**Snapshot players (`s.ps`) are per-client and delta-encoded** (`shared/netcodec.js`, ~7 KB/s per client instead of ~50):
- Entry `[k, ...fields]`, `k = id*2048 + mask`; mask bit i ⇒ field i follows: 0-2 x,y,z (delta, 1/50 m), 3 yaw (delta,
  1/1024 turn), 4 pitch (delta, 1/100 rad), 5 phase, 6 held item, 7 emote, 8 flags, 9 `every`; bit 10 = keyframe
  (all 10 fields absolute). Keyframes are sent for new players and every 5 s per player.
- Unchanged players are left out (the client holds the last state). Use `createSnapshotDecoder()` to read `ps`; never
  drop an `s` message on the client (main.js buffers the ones that arrive before the `Game` exists).
- Interest management: enemies within 120 m every tick, 120-260 m every 2nd tick, farther every 4th (`every`); squad
  mates always every tick. The client draws a player sent every N ticks `(N-1)/20` s further in the past, and the
  server's lag compensation rewinds that player by the same amount (`Match.netDelay`).
- `sh` (shots) and `sw` (tackle swings) events only go to players within 320 m / 160 m.

## Graphics quality (client/js/quality.js)
`setQuality('auto'|'low'|'medium'|'high')`, `getQuality()`, `getQualityInfo()`, `onQualityChange(fn)`; also on
`window.__fr.quality`. Saved in localStorage `fr_quality` (auto's measured level in `fr_quality_auto`). Presets set
how many players get full detail and how far, LOD/loot/fog distances, pixel ratio and clear-coat; every preset scales
resolution down to 50-60% when fps stays under target (60 desktop, 30 mobile/Chromebook) and back up when it recovers.

## Rules every change must follow
- **Original content only.** No Fortnite/Epic, NFL, NCAA or brand names, logos, likenesses or assets. No real people.
- Kid audience: no blood/gore, no chat with strangers, keep privacy protections (emails never shown or stored readably).
- Server stays authoritative. Never trust client numbers for damage, loot, Ball Bucks.
- Keep `npm test` green; add tests for new server rules.
- Commit with a clear message ending with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015QgzwJDeVWyFe7Ny1hQxci`
