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
| `shared/map.js` | Seeded generator for the Giant Sports City (boxes, decor, trees, loot spots, chests, POIs, vehicle spots) |
| `shared/vehicles.js` | Vehicle types (Tailgate Truck, Sideline Cart), spawn list per match kind, arcade car physics `stepVehicle`, collision footprint |
| `shared/weapons.js` | Weapons (5 rarities), consumables, damage |
| `shared/skins.js` | Outfit presets, Longhorn Item Shop (`SHOP`), Daily Shop pool (`DAILY_POOL`), emotes, Ball Bucks rewards, `sanitizeSkin` |
| `shared/shop.js` | ⭐ Daily Item Shop rotation: `dailyShop(dateKey, forced)` (seeded by the UTC date), `utcDateKey`, `nextResetAt` |
| `server/index.js` | HTTP static server, WebSocket hub, rooms, friend squads, admin hub actions |
| `server/match.js` | One match: authoritative rules (movement validation, hitscan w/ lag compensation, projectiles, loot, storm, building, death, win, rewards) |
| `server/bots.js` | Bot AI |
| `server/vehicles.js` | `VehicleSystem`: who drives what, validating driven vehicles, run-over tackles, vehicle damage, `vh` snapshot field |
| `server/accounts.js` | Accounts: username (ALL CAPS), email stored only as HMAC hash, scrypt passwords, sessions, Ball Bucks |
| `server/static.js`, `server/net.js` | Static files (CSP, gzip/brotli, ETag caching, versioned `/vendor/three@x/`), client IP + rate limiter helpers |
| `server/safefile.js` | Atomic JSON saves, rolling backups, corrupt-file recovery (used for `accounts.json`, `admin.json`) |
| `server/admin.js` | `/admin` panel API (password `ADMIN_PASSWORD`), news, broadcasts, scheduled parties, today's Daily Shop (`todayShop()`, admin-featured items) |
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
| `client/js/vehicles.js` | Vehicle models, interpolation of everyone's vehicles, driving my own vehicle, chase camera |
| `client/js/hud.js`, `client/js/audio.js` | HUD helpers; Web Audio procedural sounds + party music |
| `client/admin.html` | Admin web panel |
| `tools/build_human.py` | Converts MakeHuman CC0 data into `client/assets/human*.{json,bin}` |
| `tools/netmeter.js`, `tools/serverbench.js` | KB/s per client (headless ws client); server CPU per tick with N full matches |
| `tools/rendermeter.js`, `tools/lodstats.js`, `tools/lodshot.js` | Playwright: draw calls/triangles/GPU memory (incl. a 74-player crowd and spawn/despawn leak check), triangles per LOD, LOD screenshot |

## Network protocol (JSON over `/ws`)
Client → server: `hello{token,skin}`, `signup`, `login`, `logout`, `join{create|room|mode}`, `start`, `leave`,
`in{x,y,z,yaw,pitch,em,ph}` (20 Hz), `jump`, `deploy`, `fire{aim,dirs,rt}`, `reload`, `slot{i}`, `pickup{id}`,
`open{id}`, `drop`, `build{k,gx,gy,gz,r}`, `veh{id}` (get in vehicle `id`; `veh{}` gets out), `buy{item}`, `delete_account{password}`, `spec{id}` (dead player: who they spectate), `party_*`, `admin{action}`.
Server → client: `info{news,events,shop}` (on connect and whenever it changes), `auth`, `auth_needed`, `profile`, `bought{item}`, `welcome`, `lobby`, `start`, `s` (20 Hz snapshot: `ps` player
entries, `pg` players to forget, `ev` events, `zn` zone, `me` private state, `pe` personal events), `end`, `closed`, `reward`, `bc`, `party_time`, `account_deleted`, `delete_error`, `error`.
Pages must keep working under the CSP: no inline `on*=` handlers and no `eval`; inline `<script>` blocks are allowed
automatically (the server hashes them), inline styles are fine.

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

**Vehicles (`s.vh`, `server/vehicles.js`, `shared/vehicles.js`).** ~17 vehicles at fixed spots in the city
(`map.vehicles`, ids = index + 1, the same everywhere), 2 carts on Party Island. Each is in the collision `World`
as two square boxes (`kind:'vehicle'`, `vid`), so players, bots, bullets and other vehicles bump into it; the nav
grid blocks the parked spots. Entry `[id, x, y, z, yaw, speed, driverId, hp%, broken]`, sent to a client only
when it changed since the last entry that client got (every tick within 160 m, every 4th tick farther); the
first snapshot has all of them, parked vehicles cost nothing. Clients interpolate them like players.
- Driving: `veh{id}` within 3 m of a free, working vehicle → personal event `pe ['veh', id, x, y, z, yaw]`
  (`['veh', 0]` + `corr` when you get out, die, quit or it breaks down; you're placed beside it). The driver's
  client runs `stepVehicle` and sends `in{x,y,z,yaw,pitch,vy,vs}` (`vy` vehicle yaw, `vs` speed); the server
  allows up to 22 m/s, rejects positions inside or through walls (`pe ['vc', x, y, z, yaw]` correction) and moves
  the vehicle boxes. No `fire/reload/pickup/open/drop/build` while driving.
- Run-over: hitting an enemy at > 8 m/s = 20-55 damage (`kf` weapon `vehicle`) + knockback (`kb`), 1 s cooldown
  per target; Party Island: a bump, no damage. Bullets/tackles/explosions damage vehicles (truck 450, cart 260 hp);
  at 0 hp it breaks down (`ev ['vb', id]`, smoke, can't be driven). Drivers sit up high: their head/chest can
  be shot over the vehicle box, and they take storm and explosion damage normally.

## Item shops and Ball Bucks
Two shops, one screen (`#shop`, tabs; the Daily Shop is the default tab). Prices: every item costs 1,000+ Ball Bucks.
- **🐂 Longhorn Item Shop**: `SHOP` in `shared/skins.js` (presets/emotes with `price` and no `shop` field). Always for sale.
- **⭐ Daily Item Shop**: `DAILY_POOL` = presets/emotes with `shop: 'daily'` (14 outfits, 5 emotes, 1,000-2,500).
  `dailyShop(utcDate)` shuffles the pool with `makeRng(FNV-1a('football-royale-daily|YYYY-MM-DD'))` and picks
  2 Featured (Epic/Legendary outfits) + 3 outfits + 2 emotes, so every server and player gets the same shop; it changes
  at 00:00 UTC. The server sends it in `info.shop = {date, resetsAt, now, featured:[id], items:[id]}` (ids index
  `DAILY_POOL`; `now` lets the client's countdown follow the server clock) and pushes a new `info` at midnight.
- `buy{item}` → `accounts.buy(user, id, admin.todayShop())`: Longhorn items always, Daily items only while in today's
  shop (`featured` or `items`), otherwise an `error`. Owned ids live in `profile.owned` forever; `canUseSkin` /
  `canUseEmote` only check ownership, so items stay wearable after they rotate out.
- Admin: `/admin/api/feature {item, remove?}` adds (or removes) a `DAILY_POOL` item to today's Featured row (max 3 a
  day, stored in `admin.json` `featured:{date, ids}`, ignored after that date); `state` returns `shop`, `forced`, `shopPool`.
- Outfit `style` options drawn by `human.js`: `bolts`, `towel`, `crowns`, `pads`, `crewSocks`, `armSleeve`,
  `whiteNumbers`, `cleats`, `referee`, plus `yoke` (shoulders in the accent color) and `hoops` (two accent bands).
  Emotes 9-13 (Spin Move, Air Guitar, Sprinkler, Chest Flex, Wave Ripple) are animated in `animatePlayer`.
- Real-money Ball Bucks packs are disabled ("Coming soon"); Ball Bucks come from matches and admin gifts.

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
