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
| `shared/map.js` | Seeded generator for the Giant Sports City (boxes, decor, trees, loot spots, chests, POIs, vehicle spots, elevators) |
| `shared/megadome.js` | ⭐ The Mega Dome stadium in the middle of the map (`DOME` layout numbers, `roofY`, `underDomeRoof`, `buildMegaDome`) |
| `shared/elevators.js` | ⭐ Elevators: cab height = f(server clock), collision boxes (cab column + doors), shaft walls |
| `shared/districts.js` | The newer districts (Skyline Heights, Gridiron Galleria, Huddle Shops, Fuel Stop, Kickoff Academy, Splash Zone, Signal Hill, farms, neighborhoods, Pit Stop Garage, ring roads) and the building kit: `shell` (one floor), `office` (multi-story with stairs to the roof), `tower`, `groundStairs`, parking rows. Own seeded RNG |
| `shared/vehicles.js` | Vehicle types (Tailgate Truck, Sideline Cart, Hatchback), spawn list per match kind, arcade car physics `stepVehicle`, collision footprint |
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
| `client/js/stadium.js` | Draws the Mega Dome: glass, vault roof, arches, video board, ribbon boards, seat backs, concourse dressing, instanced elevator cabs/doors |
| `client/js/menuScene.js` | Animated stadium home-screen background |
| `client/js/vehicles.js` | Vehicle models (3 LODs: full / instanced parked / instanced boxy far), interpolation of everyone's vehicles, driving my own vehicle, chase camera |
| `client/js/hud.js`, `client/js/audio.js` | HUD helpers; Web Audio procedural sounds + party music |
| `client/admin.html` | Admin web panel |
| `tools/build_human.py` | Converts MakeHuman CC0 data into `client/assets/human*.{json,bin}` |
| `tools/netmeter.js`, `tools/serverbench.js` | KB/s per client (headless ws client); server CPU per tick with N full matches |
| `tools/mapcheck.js`, `tools/navdump.js`, `tools/cityshots.js`, `tools/drivesmoke.js` | Map report (box/vehicle/loot counts, blocked vehicle spots, loot in walls, unreachable bags); bots' nav grid around a spot; Playwright screenshots + draw calls from fixed camera spots (`PORT=4802 node tools/cityshots.js outDir [name..]`); browser smoke test driving a Hatchback (LOD bands, page errors) |
| `tools/domeshot.js`, `tools/domeplay.js` | Playwright: Mega Dome screenshots from fixed views (no match); a real Party Island session riding an elevator |
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

**Vehicles (`s.vh`, `server/vehicles.js`, `shared/vehicles.js`).** Every car in the city is drivable: ~167
vehicles at fixed spots (`map.vehicles`, ids = index + 1, the same everywhere: parking lots, street parking,
driveways, the Fuel Stop, garages, farms); there are no static car boxes. 2 carts on Party Island. Each is in the
collision `World` as two square boxes (`kind:'vehicle'`, `vid`), so players, bots, bullets and other vehicles bump
into it; the nav grid blocks the parked spots. `generateMap` drops any spot that isn't clear (a tree or random
house on it). Entry `[id, x, y, z, yaw, speed, driverId, hp%, broken]`, encoded only after the vehicle changed
(`v._net` is cleared by `place()`, driving, entering/leaving and damage) and sent to a client only when it changed
since the last entry that client got (every tick within 160 m, every 4th tick farther); the first snapshot has all
of them, parked vehicles cost nothing. Clients interpolate them like players.
- Client LODs: full model (turning wheels, seated driver) within 16 m of the camera, when driven or for 2 s after
  it moved; otherwise one `InstancedMesh` per model+color (baked body + wheels) up to 90 m, and beyond that one
  `InstancedMesh` per model made of a few boxes tinted with `instanceColor`. Only shown vehicles are packed into
  an instanced mesh's first `count` slots (`flush()`), so ~170 parked vehicles cost ~20 draw calls.
- Driving: `veh{id}` within 3 m of a free, working vehicle → personal event `pe ['veh', id, x, y, z, yaw]`
  (`['veh', 0]` + `corr` when you get out, die, quit or it breaks down; you're placed beside it). The driver's
  client runs `stepVehicle` and sends `in{x,y,z,yaw,pitch,vy,vs}` (`vy` vehicle yaw, `vs` speed); the server
  allows up to 22 m/s, rejects positions inside or through walls (`pe ['vc', x, y, z, yaw]` correction) and moves
  the vehicle boxes. No `fire/reload/pickup/open/drop/build` while driving.
- Run-over: hitting an enemy at > 8 m/s = 20-55 damage (`kf` weapon `vehicle`) + knockback (`kb`), 1 s cooldown
  per target; Party Island: a bump, no damage. Bullets/tackles/explosions damage vehicles (truck 450, cart 260 hp);
  at 0 hp it breaks down (`ev ['vb', id]`, smoke, can't be driven). Drivers sit up high: their head/chest can
  be shot over the vehicle box, and they take storm and explosion damage normally.

## The city (shared/map.js + shared/districts.js)
## The Mega Dome (shared/megadome.js, client/js/stadium.js)
## Elevators (shared/elevators.js)
~2,560 boxes (~2,160 drawn as one merged mesh; tree trunks are drawn as instanced trees), 26 named places. Building rules:
- Steps are 0.5 m (`PLAYER.stepUp` 0.7). Multi-story `office()` buildings: 4 m floors, 8 steps x 0.7 m in a
  switchback stairwell along one wall, a hole in each slab over its flight, a wall beside each flight up to the
  slab (the step-up doesn't check head room, so without it you could step up with your head in the slab), roof
  parapet 0.6 m (you and bots can step over it). Kind `facade` walls get a window band per floor in world.js.
- Bots' nav grid only knows one floor per cell (ground-standing boxes): upper floors and roofs are for players;
  bots skip loot they can't path to. Ground-standing stairs to a solid platform (`groundStairs`, 1 m deep steps so
  the 1 m grid sees 0.5 m rises) work for bots too (slide towers, TV tower base). Equipment Bags only on ground
  floors or such platforms (`test/bots.test.js` checks every bag is reachable).
- Loot spots of the districts are nudged out of walls/steps/partitions; `test/map.test.js` checks loot, stairs
  (walks up Huddle HQ to the roof), head room beside flights, determinism and the POI list.
- Decor types for the new places: `tint` (colored flat: pools, crops, track, upper floors), `sign` (name board,
  canvas texture), `slide` (water slide tube).
- Leave the Mega Dome area (|x| < 135, |z| < 105) to the stadium code; districts only reserve land outside it.

## Item shops and Ball Bucks
Two shops, one screen (`#shop`, tabs; the Daily Shop is the default tab). Prices: every item costs 1,000+ Ball Bucks.
- **🐂 Longhorn Item Shop**: `SHOP` in `shared/skins.js` (presets/emotes with `price` and no `shop` field). Always for sale.
- **⭐ Daily Item Shop**: `DAILY_POOL` = presets/emotes with `shop: 'daily'` (28 outfits, 11 emotes, 1,000-2,500;
  Uncommon 1,200 · Rare 1,500 · Epic 2,000 · Legendary 2,500, emotes 1,000-2,000).
  `dailyShop(utcDate)` shuffles the pool with `makeRng(FNV-1a('football-royale-daily|YYYY-MM-DD'))` and picks
  2 Featured (Epic/Legendary outfits) + 4 outfits + 3 emotes (`DAILY`), so every server and player gets the same shop;
  it changes at 00:00 UTC.
- **New batches**: items with `added: NEW_BATCH_DATE` ("Big Game Drop", 14 outfits + 6 emotes, 2026-11-21) are NEW for
  `NEW_DAYS` (30) days (`isNewItem(item, date)`: NEW! badge on the cards, the preview and the Item Shop button). While
  new, each day spotlights part of the batch in a fixed seeded order (1 Featured Epic/Legendary outfit, 2 more outfits,
  1 emote; the rest of the day is the normal random pick), so all of it is in the shop within a week; afterwards it is
  a normal part of the pool. For the next batch: give its items `added` = the new date and move `NEW_BATCH_DATE`.
- Shop cards: clicking the art (🔍) opens `#shop-preview`: the Locker Room preview canvas moves into the pop-up and
  shows the outfit on a turntable (drag to spin) or your player doing the emote, with feature chips and a buy button.
  Emote card posters use `EMOTES[].art` (seconds into the emote). The server sends it in `info.shop = {date, resetsAt, now, featured:[id], items:[id]}` (ids index
  `DAILY_POOL`; `now` lets the client's countdown follow the server clock) and pushes a new `info` at midnight.
- `buy{item}` → `accounts.buy(user, id, admin.todayShop())`: Longhorn items always, Daily items only while in today's
  shop (`featured` or `items`), otherwise an `error`. Owned ids live in `profile.owned` forever; `canUseSkin` /
  `canUseEmote` only check ownership, so items stay wearable after they rotate out.
- Admin: `/admin/api/feature {item, remove?}` adds (or removes) a `DAILY_POOL` item to today's Featured row (max 3 a
  day, stored in `admin.json` `featured:{date, ids}`, ignored after that date); `state` returns `shop`, `forced`, `shopPool`.
- Outfit `style` options drawn by `human.js`: `bolts`, `towel`, `crowns`, `pads`, `crewSocks`, `armSleeve`,
  `whiteNumbers`, `cleats`, `referee`, plus `yoke` (shoulders in the accent color) and `hoops` (two accent bands).
  Newer ones (lists in `shared/skins.js`, all baked into the existing per-player meshes or one extra shared-material
  mesh, so a full-detail player costs at most ~3 more draw calls and nothing at mid/crowd LOD):
  `pattern` (`OUTFIT_PATTERNS`: flames, camo, stars, chevron, sash, candy, split, sweater, frost, dino, mech, stripes;
  painted per vertex on the jersey shell, second color `pat2`), `gloves`, `visor` (tint), `glow` (unlit glowing helmet
  stripe/collar/belt/cleat stripes), `chrome` (metal helmet + mask), `decal` (`HELMET_DECALS`: icon on both helmet sides
  from one shared atlas, `decalColor`/`decalEdge`), `fin` (`spikes`, `antenna`), `back` (`cape`, `jetpack`;
  `backColor`/`backColor2`), `chute` ([canopy, stripe] parachute colors). Style always comes from the preset, never the client.
  Emotes 9-19 (Spin Move, Air Guitar, Sprinkler, Chest Flex, Wave Ripple, Robo Rumble, Field Goal Kick, Trophy Hoist
  (gold cup prop), End Zone Twirl, Hike Hike Hike, Dino Stomp) are animated in `animatePlayer`.
- `PORT=4803 node tools/skinshot.js out.png [presetIds]` (env `EMOTES=14,15`, `ZOOM=2`, `COLS=6`, `DETAIL=lazy`):
  Playwright close-ups of outfits front/back or emote poses; `test/newbatch.test.js` checks the batch.
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
bags 10/30/32/20/8 %. ~470 floor spots + 57 bags for 75 players (the city doubled in buildings; ~60 random
"wild" spots). Kills by weapon (Normal, 6 matches, 444 kills): SMG 33%,
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
