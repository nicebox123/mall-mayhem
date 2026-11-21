# MALL MAYHEM (Update 3: The Big Mall & Mayhem Update)

Goofy physics VR multiplayer sandbox in a shopping mall. Runs in the **Meta Quest 3 browser** via WebXR (no install, no sideloading). Desktop players can join with keyboard and mouse.

## Update 3 at a glance
- **The mall is huge now**: about 150 × 100 m with 3 levels plus a roof (it used to be one 48 × 36 m room).
  - **Ground floor**:
    - A giant Mega Mart (9 long aisles, 4 checkout lanes with conveyor belts, NPC cashiers, self-checkouts, wall fridges with opening glass doors, chest freezers, produce, bakery, stockroom with pallets, automatic doors, cart corral, baskets)
    - A food court with 4 restaurants (each with a food button)
    - Toy Tornado (mega ball pit, free foam blasters)
    - Drip Depot clothing
    - Comfy Kingdom furniture (bouncy beds)
    - The Pixel Palace arcade
    - Volt City electronics (TV wall)
    - Cinema
    - Bathrooms (flushing toilets, hand dryers)
    - Staff and security rooms
    - Atrium with fountain and palms
    - Parking garage
    - Outdoor entrance plaza
  - **L2**: balcony ring, Bounce Zone trampolines, bookstore, Sky Cafe, garage roof deck.
  - **Roof**: rooftop with a skylight hatch that drops you into the fountain.
  - **Getting between floors**: escalators that carry you, stairs, a glass elevator, roof stairs, and a SUPER SLIDE from L2 down to the atrium.
  - **Secrets**: a bookshelf door on L2 hides the manager's office (with the secret button). A suspicious poster in the cinema is a fake wall into the Backrooms.
  - **Fast travel**: MALL DIRECTORY kiosks.
- **Slapping and punching rebuilt**: your headset now checks the swept path of your hand against each target's head, body, and leg capsules every frame. A hit happens only on real contact while you're swinging into someone. You get instant sound, haptics, and SLAP!/POW! pop-ups, and everyone sees it.
- **Arcade combat**: health (100), knockback, knockouts with a 5 s respawn, Foam Dart Blasters and Boing Ball Launchers (full auto while you hold the trigger), thrown objects hurt, and falls go splat. PvP damage can be turned off in Settings → Combat.
- **Cartoon ragdolls**: every knockdown is a synced physics ragdoll. Blocky characters can pop their head and limbs off (clean cartoon blocks, no gore) and snap back together when they get up. GLB-model shoppers tumble as one rigid body. Settings: parts pop off ON/OFF, NORMAL/EXTREME.
- **New NPCs**: a lazy employee who sleeps standing up, an overly serious manager who follows you lecturing, an annoying kid who tags along, a weird customer who walks backwards, and NPC cashiers who scan whatever reaches them on the belt. 24 shoppers across 2 floors.
- **New events**: free samples (shopper stampede), cart avalanche, price check on aisle five, plus all the old ones.
- **Background music removed**. A soft crowd murmur, fountain sounds, and arcade bleeps replace it (the "Ambience" slider).
- **Performance**:
  - A custom spatial-hash physics broadphase plus a sparse collision matrix (physics went from about 10 ms to about 2 ms per step).
  - Vertex-colored chunk merging (draw calls went from about 1,100 to about 230).
  - Instanced products, crowd distance culling, and objects that sleep when they settle.

## Why WebXR instead of Unity
- Quest 3 runs it straight from a URL, and friends join from a headset or a PC.
- No build pipeline, no Meta developer account, no APK sideloading.
- The systems (host-authoritative net, data tables, velocity-driven grabbing) port cleanly to Unity + Netcode/Photon later if you outgrow the browser.

## Dependencies (all loaded from CDN, nothing to install)
| Library | Version | Purpose |
|---|---|---|
| three.js | 0.160.0 | Rendering + WebXR (head/hand tracking) |
| cannon-es | 0.20.0 | Physics |
| PeerJS | 1.5.4 | WebRTC multiplayer + voice. Uses the free public PeerJS broker (0.peerjs.com) for matchmaking only. Game data goes peer-to-peer. |

Sounds and ambience are generated live with Web Audio (plus your uploaded slap, siren and Baby Ash clips). The announcer uses the browser's speech synthesis.

## Running it
WebXR requires **HTTPS**. Pick one:
1. **GitHub Pages** (free, permanent): push this folder to a repo, turn on Pages, then open `https://<you>.github.io/<repo>/` in the Quest Browser.
2. **Netlify Drop**: drag this folder onto app.netlify.com/drop and open the HTTPS link on your Quest.
3. **Local testing on PC** (desktop mode only): `python serve.py 8124`, then open http://localhost:8124

## VR controls (Quest Touch)
| Input | Action |
|---|---|
| Grip | Grab / release (throw by letting go mid-swing) |
| Trigger | Click UI (laser) · press buttons · "use" held item |
| Left stick | Smooth move |
| Right stick left/right | Snap turn (or smooth turn in Settings) |
| Right stick forward | Teleport arc, release to jump |
| X / Y (or B) | Wrist menu |
| Finger poke | Press physical buttons and UI panels |
| Swing an open hand | SLAP (open hand) |
| Swing with grip held | PUNCH (fist) |
| Trigger while holding a blaster | Fire (hold for full auto) |

## Desktop controls
WASD move · Shift sprint · mouse look · left click grab/release (on empty air it punches) · F punch · right click fires a held blaster, power-throws anything else, or presses a button · E use/spray · scroll changes hold distance · Tab wrist menu.

## What's in the prototype
- **Mall**: Mega Mart (shelves, 2 registers, melon bin), Storage (stock, mops, a secret), Chow Town food court (grill, dispensers, order board), Toy Tornado (ball pit, stackable blocks, ducks), Drip Depot (Style Station + outfit mannequin), Pixel Palace Arcade (unlockable: hoop shot + Whack-a-Button), concourse with fountain, escalator, and security booth. Cinema, electronics, parking garage, and level 2 are "coming soon" storefronts.
- **Physics**: ~100 grabbable objects (carts you can load up, mops, chairs, food, toys, a hinged door). Held objects chase your hand with velocity, so they still collide with walls.
- **Jobs** (optional, Job Board by Storage or the wrist menu): Cashier, Stocker, Janitor, Food Worker, Security (patrols + shoplifters).
- **NPCs**: 12 shoppers, 6 personalities (Chill, Karen, Nervous, Kid, Grandpa, Influencer). They path around the mall, browse, react to you, get bonked, slip on spills, and get confused by junk on the floor.
- **Random events**: power outage (flashlight), fire alarm, mega sale (double pay), stampede, lockdown shutters, spills, broken escalator, announcements. Or press the red CHAOS button at Security.
- **Progression**: money, 5 store upgrades, arcade unlock, 7 hats + 6 accessories (2 earned through achievements), 11 achievements, 3 daily challenges. Progress saves in browser storage.
- **Multiplayer**: up to 8 players. Quick Join Public (auto-hosts if empty), Host Private (4-letter code), Join With Code. Synced heads, hands, names, outfits, physics objects, NPCs, events, and jobs. Optional voice chat (proximity volume).

## Update 2: Chaos & Comedy
- **Baby Ash**: if something burns for 9 seconds it crumbles to ash. After a short beat of silence, the baby image punches onto everyone's screen with the scream, holds, then fades. It has a 40 s cooldown so it stays special. Synced across multiplayer.
- **Fire system**: cartoon flames that spread to nearby objects, a fire alarm (your siren sound), emergency lights, NPC panic, and sprinklers that switch on automatically if a fire is ignored for 30 s.
- **Fire safety gear around the mall**: 5 wall-mounted extinguishers, 2 tethered fire hoses (they snap back if you walk too far), 4 pull alarms that trigger sprinklers, and ceiling sprinklers.
- **Employee Supply** (kiosk by the Job Board + wrist **GEAR** tab): extinguisher, water sprayer (leaves puddles), mop, cartoon blowtorch, leaf blower, megaphone, rubber chicken, banana peels, wet floor sign. Buy once, then press GET any time.
- **Tools**: they snap into your hand and aim where your controller points. Hold the trigger to spray (desktop: hold E).
- **NPC overhaul**: 14 shoppers built from your models plus the blocky ones:
  - Grandma with a cart who gets furious if you block her
  - An old man who stares way too long
  - An angry customer who storms off listing complaints
  - A lost shopper who questions your job performance
  - Two security guards who investigate incidents and chase you if you bonk people
  - A trainee who keeps dropping merchandise
  - A tourist who photographs you with a flash
  - NPCs bump into each other and argue, stumble after light hits, slip on peels, and get run over by carts
- **Physics comedy**: carts roll and knock shoppers down, smashing into shelves makes products rain off, a cereal-box display triggers a gasp when it falls (the trainee rebuilds it), and peels make shoppers slip.
- **New random events**: sprinkler false alarm, security investigation, mass confusion, conga line, and melon delivery from the ceiling. Every event has a weight, a cooldown, and a proper ending.
- **Fixed VR hands**: your rigged hand model is aligned to WebXR grip space by measuring the rig itself (palm faces the handle, fingers wrap it, the left hand is mirrored). Grip curls the fingers, the trigger curls the index finger, and pokes use the real fingertip bone.
- **Volume**: Sound FX and Music sliders with mute in the wrist menu (MENU tab) and in Settings → Audio & Game.

### Changing sounds
Open `js/sounds.js`:
1. Drop an `.mp3` in `assets/sounds/` and add it to `SOUND_FILES` (for example `boing: 'assets/sounds/boing.mp3'`).
2. Point any event in `SOUND_EVENTS` at it, for example `npcFall: { file: 'boing', vol: 0.8, cooldown: 0.2, positional: true }`.

Each event has volume, cooldown (anti-spam), 3D positional on/off, and random pitch.

### Performance notes
The two Character Creator models are heavy (about 57k and 105k triangles). At load the game converts them to cheaper materials, shrinks their textures to 512 px, and hides face parts you can't see. If it stutters on Quest, set **Settings → Audio & Game → NPC models: LITE** to use blocky shoppers only.

## Code layout (`js/`)
`assets.js` GLB/image loading + Quest optimization · `sounds.js` sound event config + manager · `fire.js` fire, sprays, sprinklers, Baby Ash · `hands.js` grip-space hand alignment · `characters.js` procedural animation for GLB NPCs · `particles.js` pooled particles · `main.js` boot + loop · `state.js` shared state · `config.js` all data tables · `world.js` mall + colliders + zones · `physics.js` cannon world + grab drive · `objects.js` grabbable objects · `player.js` VR rig, locomotion, hands, desktop fallback · `players.js` player state + remote avatars · `npc.js` navigation + AI · `game.js` jobs, events, triggers (host) · `net.js` PeerJS networking + voice · `ui.js` canvas panel system · `menus.js` all menus · `avatar.js` blocky characters · `audio.js` procedural sound · `save.js` progression.

## Known limits / next steps
- Host-authoritative: if the host leaves, everyone returns to solo play.
- Public lobbies are 5 fixed rooms (PUB1–PUB5). A real server browser needs a small backend.
- Doors and NPCs don't block player movement.
- Progress is stored locally per device and trusted (no anti-cheat).
