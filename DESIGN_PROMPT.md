# Football Royale – Master Design Prompt

This is the "master prompt" the game was built from. It follows what tends to work best
when asking an AI to build a multiplayer game:

1. Name the exact tools.
2. Make the server the referee from day one.
3. Spell out every system.
4. Ban copyrighted material.
5. Build in small, playable milestones.

Paste it (or one milestone of it) into Claude any time you want to add features.

---

## The prompt

> You are building **Football Royale**, an original, free, web-based multiplayer
> **first-person battle royale** for kids aged 10–14. Players open a link in a desktop
> browser (Chrome/Edge/Firefox) and play with friends. Nothing to download, no accounts.
>
> **Theme:** every player is an **American football player** (helmet, facemask,
> jersey with a number, pants, socks). The map is an island called the **Giant Sports
> City**. Cartoon, low-poly look. No blood: hits flash, eliminated players "fumble" and
> vanish in a burst of confetti.
>
> **Originality rules (very important):** do NOT use any names, characters, art, sounds,
> maps, UI layouts or item names from Fortnite or any other existing game, and no NFL or
> real team names/logos. All art is drawn from code (three.js shapes + canvas textures)
> or comes from CC0 asset packs. All sounds are generated with the Web Audio API.
>
> **Tech stack:**
> - Client: plain JavaScript ES modules + **three.js** (MIT), served as static files
>   with an import map, so there's no build step.
> - Server: **Node.js 20+** with the **ws** WebSocket library. The server is
>   *authoritative*: it owns health, damage, loot, zone, building pieces, bots and
>   who wins. Clients send inputs and positions. The server checks them (speed
>   limits, fire rate, ammo, distance to loot) before accepting them.
> - Shared folder `/shared` used by both client and server: constants, weapon
>   definitions, map generator (fixed seed so every client builds the same city),
>   physics / collision / raycasting.
> - Netcode: 20 Hz server tick. Clients render other players ~100 ms in the past with
>   snapshot interpolation. The local player moves instantly (client-side movement).
>   The server does hit detection with **lag compensation** by rewinding target
>   positions to the time the shooter saw.
> - Deployable to a free Render.com web service with `npm start` (reads `PORT`).
>
> **Match flow:**
> 1. **Locker Room (menu):** enter a name, pick and customize a skin, choose **Build** or
>    **No-Build** mode, then *Quick Play* (public), *Create Private Room* (4-letter code
>    and share link) or *Join with Code*.
> 2. **Lobby:** up to **75 players**. When the match starts, **bots fill every empty
>    spot** (difficulty: Easy / Normal / Hard).
> 3. **The Team Blimp** flies across the island. Press Space to jump. You free-fall and
>    steer, then a parachute opens automatically near the ground (or press Space).
> 4. **Loot** lies on the floor and in **Equipment Bags** (chests). Press E to pick up.
> 5. **The Overtime Storm** (shrinking zone) forces fights. Each phase waits, then
>    shrinks to a new smaller circle inside the old one. Being outside hurts more each phase.
> 6. Last player standing wins: "FOOTBALL ROYALE CHAMPION!". Dead players spectate.
>
> **Player:** 100 Health + up to 100 Padding (shield). WASD move, Shift sprint, Space
> jump, mouse aim, left click fire, right click aim/scope, R reload, 1–6 or scroll
> for slots, E pick up / open / use, G emote menu, M big map, Tab scoreboard.
>
> **Weapons (5 rarities: Common, Uncommon, Rare, Epic, Legendary, each with more
> damage):**
> - Normal-style guns, with original names: Rookie Pistol, Blitz SMG, Linebacker Rifle,
>   Sack Shotgun, Hail Mary Sniper.
> - Sports specials: **Pigskin Cannon** (launches exploding footballs) and
>   **Whistle Grenade** (throwable).
> - Melee: **Tackle** (always in slot 1). It also collects building materials in Build mode.
> - Healing: Tape Roll (+15 HP), Trainer's Kit (full HP), Padding Pack (+50 Padding).
>
> **Build mode:** materials called **Turf**. Z = wall, X = floor, C = ramp on a 4 m grid,
> 10 Turf each. Pieces have health and can be shot down.
>
> **Skins:** original team presets (Lava Llamas, Neon Narwhals, Cosmic Coyotes,
> Thunder Toads, Midnight Moose, Gold Rush Gophers, Ice Pirates, Robo Rhinos) and a
> custom editor (jersey, trim, helmet, number). Some skins unlock with wins and
> eliminations (saved in the browser).
>
> **Emotes** (third-person camera while emoting): Gridiron Shuffle, Touchdown Spike,
> Victory Dance, Helmet Salute, Ref Signals.
>
> **Map, Giant Sports City:** the Mega Dome stadium in the center, Practice Fields,
> Locker Town (downtown), Tailgate Lot, Training Camp Woods, Hall of Champs, plus
> suburbs and roads. Buildings you can walk into, stadium stands you can climb.
>
> **HUD:** health and padding bars, hotbar with rarity colors, ammo, Turf, players left,
> eliminations, storm timer, minimap, kill feed, hit markers, damage numbers.
>
> **Milestones (build and test each before moving on):**
> M1 walk around the city in first person → M2 multiplayer movement with rooms →
> M3 weapons, damage, death → M4 loot and inventory → M5 blimp drop and storm →
> M6 bots → M7 building → M8 skins and emotes → M9 sounds and polish → M10 deploy.

---

## Ideas for later (version 2)

- Squads / Duos mode (team up with friends)
- Vehicles: golf carts or a mascot-costume speed boost
- A "Field Goal" jump pad that launches you across the map
- Daily challenges and an XP level bar
- Mobile touch controls
- Seasonal map changes (snow stadium!)
