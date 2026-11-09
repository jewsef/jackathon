# Beyond Civilization

A god game of indirect control, played in the browser.

Five islands. Five tribes, each grown from **one man and one woman**. You never give orders: you command the sky, the sea and the sickness, and the people decide what to do about it. They marry, work, invent boats, feud, fight and fall sick. The long test is whether anyone ever crosses the deep sea to **the Far Shore**, and later whether ocean ships find the lands beyond the horizon, where two more peoples have been growing on their own all along.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static game in dist/ (open dist/index.html through any static server)
npm test           # simulation and milestone tests
```

- **3D view** (default, desktop). Looking around:
  - **WASD / arrow keys** move (hold for smooth scrolling, works without clicking the map first)
  - **Mouse wheel** zooms toward the cursor; **trackpad** two-finger scroll pans and pinch zooms
  - **Drag** pans; **right-drag, middle-drag or Shift-drag** orbits and tilts
  - **Q / E** rotate, **T / G** tilt, **Z / X** zoom, **R** or the compass faces north
  - **Edge scrolling**: push the mouse to the map edge (toggle under the minimap)
  - **Minimap**: click or drag to jump; the outline shows what the camera sees
  - **Double-click** the ground to fly there
  - **Follow**: select a person, boat or village and press *Follow with the camera* (Esc or any camera move stops it)
- **Day/night** toggles the day cycle; at night village hearths light the islands.
- **2D map** is still available from the top bar. For slower machines set `localStorage["bc.quality"] = "low"` in the browser console and reload.
- **Pick a power** on the left, then click the map. Energy refills from the faith of your people.
- **Click** villages, named people (ember rings), boats and islands to read their records in the inspector.
- **Space** pauses. Speeds run from 1× (a season every 2 seconds) to 64×.
- **Save / Load** store the seed and your action log in the browser; the world replays exactly. **Share seed** copies a link (`#seed-1234`) that gives anyone the same archipelago.

### Powers

| Power | Cost | What it does |
|---|---|---|
| Calm | free | Clear nights and safe crossings. Sky-watchers count stars toward navigation. |
| Rain | 2 | A wet year: harvests and forests grow, love for the sky rises. |
| East wind | 2 | Boats sail faster east, fishing canoes get blown off course and may find new land, sails get invented. |
| Omen | 3 | A comet or red moon. The sky-speaker interprets it: peace in wartime, a call to the sea, or a festival. |
| Bless | 3 | Bless a tribe's ruler: legitimacy rises, unrest falls. |
| Drought | 4 | Fields fail. Hunger pushes raids, migration and new ideas. |
| Stir revolt | 5 | Whisper to the strongest faction out of power. If it is strong enough it rises: the regime may fall, the rebels may be crushed, or the tribe may split in civil war. |
| Storm | 6 | Sinks boats, floods coasts. Survived storms push outrigger technology. |
| Quake | 8 | Houses and walls fall. |
| Plague | 10 | Fever, Red cough or Grey death in one village. It spreads **only through contact**: island paths, trade and wedding canoes, voyages and raids. Grey death can wipe out a village. |
| Eruption | 12 | The island's peak wakes. Fire nearby, ash beyond, rich soil for a century after. |

## How it is built

The game follows the framework in [`docs/concept.html`](docs/concept.html).

**Rules**
- **A. The simulation owns the truth.** All state is one plain `World` object. The renderer only reads it.
- **B. Systems are steps.** `tick()` runs each system in order over the world with a seeded RNG.
- **C. Seeds replay everything.** A seed plus the action log rebuilds any run exactly (`replay()`, used by Save/Load).
- **D. Detail on demand.** Terrain detail chunks and crowds are generated only for what is on screen.

**Architecture**

| Layer | Where | Files |
|---|---|---|
| Player and UI | main thread | `src/main.ts`, `src/ui/*` (powers, inspector, chronicle), `src/audio.ts` |
| 3D renderer | main thread, WebGL (Three.js) | `src/render3d/view.ts` (camera, picking, overlay), `heightfield.ts`, `terrainMesh.ts` (painted relief shader), `water.ts`, `sky.ts`, `actors.ts` (instanced trees, houses, Tailfolk, boats, clouds) |
| 2D renderer | main thread, WebGL (PixiJS) | `src/render/map.ts`, `terrainTex.ts`, `crowd.ts`, `sprites.ts` (shared crowd sampler and painted terrain) |
| Simulation | Web Worker | `src/sim/worker.ts` → `tick.ts` |
| Civilization | worker | `society.ts` (villages), `agents.ts` (named people), `culture.ts` (tech, belief, faith), `conflict.ts` (war), `plague.ts` |
| Sea and travel | worker | `voyages.ts` |
| Climate and terrain | worker | `climate.ts`, `ecology.ts`, `terrain.ts` |
| Tuning data | JSON | `data/techs.json`, `powers.json`, `plague.json`, `tribes.json`, `jobs.json`, `beliefs.json` |

```ts
export function tick(w: World, acts: Action[]): World {
  w = applyPowers(w, acts, rng);  // player edits sky + ground
  w = climate(w, rng);            // season, wind, weather cells
  w = ecology(w);                 // soil, crops, forests, fish
  w = society(w, rng);            // villages: growth, hunger, jobs
  w = plague(w, rng);             // sickness along contact
  w = conflict(w, rng);           // grudges, raids, wars
  w = agents(w, rng);             // named people: goals, choices
  w = voyages(w, rng);            // boats at sea, discovery
  w = culture(w, rng);            // tech, belief, memory
  w = terrainStep(w);             // ash, floods, effects expire
  return narrate(w);
}
```

### The hybrid civilization
- **The crowd** – each village is one record: people by age and sex (0–79), food, jobs, kinship, bloodlines, buildings, morale, sickness.
- **The sample** – when you zoom in, `sampleCrowd()` draws figures from that record. If 30% of adults fish, 30% of the adult figures walk to the shore.
- **The named few** – real agents (founders, leaders, sky-speakers, navigators, captains, doctors, war leaders, speakers, inventors) promoted when the story needs a face. A leader's death can cause a succession crisis that splits a village into a new tribe.

### Society
Jobs: gatherer, farmer, fisher, builder, woodcutter, quarrier, miner, smith, leader, doctor, sky-speaker, warrior, boatwright (plus elders). Up close every person is a small solid figure coloured by job; rulers are gold and faction heads orange. Shares shift each season toward the biggest need. Settlements grow through band → camp → village → town. Small islands become one family within a few generations (**kinship**), so tribes must **marry out** across the sea. Marriages mix bloodlines (tail colours) and build alliances. Scarcity, plague blame, crowding and ambitious leaders cause raids and wars; weapons and defences (bow, palisade, shield wall, war canoe, stone fort) are only built under threat.

### Land
Every island has its own landform (`FORM` in `src/sim/terrain.ts`), so the land itself shapes how people live there:

| Island | Landform | Flat land | Highest point (as drawn) |
|---|---|---|---|
| Hearth | Farm plains with low central downs | ~70% | ~1 km |
| Kelp Isle | An atoll: sand and grass around a shallow lagoon | ~70% | ~0.2 km |
| Thornholm | Rolling forested hills and valleys | ~25% | ~1.1 km |
| Gull Rock | Sea cliffs, then a flat grassy plateau | ~75% | ~0.7 km |
| The Far Shore | Coastal plains either side of a snow-capped range | ~30% | ~2.8 km |
| The Iron Coast | Upland moors and ore-bearing ridges | ~35% | ~1.8 km |
| The Spice Isles | An old shield volcano with a crater lake | ~50% | ~1.2 km |
| The Great Land | Prairie, with a mountain range in the east | ~75% | ~1.5 km |

Coasts have bays and headlands and a narrow band of shallows. Fine detail is scaled by how rough the ground is, so plains stay walkable and mountains stay rugged. Harbours always open onto the sea, never the lagoon.

### Resources and ages
Each island has its own deposits (`data/deposits.json`): Hearth clay, Kelp Isle salt and fibre, Thornholm hardwood and tin, Gull Rock stone and herbs, the Far Shore flint and copper. Woodcutters, quarriers and miners extract them; forests regrow but mines run down. Smiths turn copper and tin into bronze, and kilns turn clay into brick. Houses, granaries, walls and temples cost materials, so a stone-poor island builds in wood or fibre. Stockpiles are shared between a tribe's villages on one island and traded along routes. A tech needs both an idea and the materials (bronze needs copper **and** tin, which never sit on the same island), so each tribe advances at its own speed. Ages, strictly in order: Early humans → Stone Age (stone tools) → Bronze Age (bronze) → Classical age (iron) → Age of Sail (ocean ships) → Industrial age (the steam engine) → Electric age (electricity) → Information age (computers) → Biotech age (genetics).

### The world beyond the horizon
The full world is 28 × 15.75 units (about 224 × 126 km). The five home islands fill the first 16 × 9; beyond them lie **the Iron Coast** (iron ore, uninhabited), **the Spice Isles** (spice, home of the Clove folk) and **the Great Land** (a long continent, home of the Tallgrass folk). Both of those peoples start like everyone else, from one man and one woman, and develop on their own. Crossing the open ocean needs **ocean ships** (boat tier 6), so until someone builds them the two worlds never meet and the far lands stay hidden in mist: no labels, no villages, no chronicle entries. When the first ocean ships are launched, *the world grows*: the mist lifts, the camera and minimap widen to the whole world, and explorers, traders and colonists sail out. Contact brings trade, marriages, war and plague in both directions.

### The Classical age and the Age of Sail
New resources: **iron** (the Iron Coast, a little on the Far Shore, Thornholm and the Great Land) and **spice** (only on the Spice Isles; it lifts morale and calms unrest wherever trade carries it). New inventions: iron (Classical age), coinage (faster trade, richer tribute), written law (legitimacy up, unrest down), aqueducts (fewer deaths from sickness in towns), philosophy and printing (faster research), siegecraft (walls count for less), war galleys (stronger raids across the sea), lighthouses and the compass (safer, faster voyages), gunpowder (cannon and star forts), **ocean ships** (Age of Sail) and cartography (share friends' charts). On the map: whitewashed Classical houses with terracotta roofs and porches, round tholoi on Kelp-style isles, columned temples, theatres, aqueducts striding in from the hills; then tall Age of Sail town houses (stepped brick gables, timber frames, slate and dormers), windmills, warehouses, lighthouses, shipyards, star forts and three-masted ships at anchor and under sail.

### The Industrial age
**Coal** lies under the Iron Coast, the Great Land, the Far Shore and a little of Thornholm and Gull Rock; the farm islands have none, so industry depends on trade or colonies. The steam engine needs coal and iron and comes after ocean ships. Then: **steel** (smelted from iron and coal), **factories** (a new job, the factory hand; mills make fibre, brick and iron and speed up building), **railways** (stores move between a tribe's towns three times faster), **steamships** (boat tier 7, fast and safe whatever the wind), **vaccines** (plague deaths cut by about two thirds), **rifles**, **the telegraph** (ideas spread twice as fast along routes) and **fertilizer** (harvests +30%).

**Pollution and climate.** Every ton of coal burned thickens the smog over its town and adds carbon to the air (`co2`, 280 ppm before industry). Smog lowers morale, worsens sickness and, when it is choking, kills the old and the young. Your **rain** and **wind** wash and blow it away. Carbon warms the whole world (3 °C per doubling), slowly drawn back down by the sea: warming brings more storms and droughts, thinner harvests and a snow line that climbs off the Far Shore's peaks, with chronicle warnings at +0.5, +1, +2 and +3 °C. On the map: terraced brick houses and stone tenements, mills with smoking stacks, pit heads over the coal, gasholders, railway stations, trains running on lines beside the roads, steamships, brown haze over industrial towns and a dirtier sky.

### The modern ages
**Oil** lies under the Great Land and the Spice Isles; **silicon** comes from pure sand, and Kelp Isle's atoll has the most. Bronze-making stops once a tribe has steel, so its copper goes into wire instead. Inventions: electricity (Electric age; motors, +10% research), the combustion engine (tractors and cars; +20% harvests), radio, flight (boat tier 8: aircraft), antibiotics, computers (Information age; +25% research), the internet, solar and wind power and nuclear power (mills burn a fraction of the coal; reactors very rarely fail), missiles, genetics (Biotech age), engineered crops (harvests hold up in a warming world), human enhancement, carbon capture (pulls carbon back out of the air) and spaceflight. A new job, the **scientist**, speeds every invention.

**Late-game powers** wake only when some people reach their age: **Spark of genius** (Classical age: a tribe leaps toward its next invention), **Rising seas** (Industrial age: a surge floods harbour towns) and **Solar flare** (Electric age: power fails, research stalls and unrest rises for a year). A warmer world also floods harbours on its own.

**Endings**: *Beyond the sky* (a tribe reaches space), *A green world* (carbon brought back below 350 ppm after passing 420), *The hothouse* (+4 °C), alongside *Beyond the horizon*, *One people*, *The long age* and *Silence*.

On the map: bungalows and brick apartment blocks, then glass towers and white houses, then terraced green towers and garden domes; coal and nuclear power stations, wind turbines, solar fields, radio masts, laboratories and greenhouses, airports with aircraft flying between them, cars on the roads and a launch pad with a rocket.

### Towns, cities and roads
Each island builds in its own way, and its buildings change with the tribe's age: Hearth goes from mud huts to flat-roofed brick houses, Kelp Isle from reed huts on stilts to tiered round houses, Thornholm from longhouses to jettied timber halls, Gull Rock from stone beehives to slate-roofed stone houses, and the Far Shore from hide tents and earth lodges to plastered timber. **The wheel** (cart tracks, faster building, stores move between villages), **paved roads** and **town planning** follow in the Bronze Age. A planned town of 350 people becomes a **city**, laid out on a grid aligned to its harbour. Roads join every village on an island along the easiest ground.

### Politics
Every tribe has a **government** (council of elders, chiefdom, council, priest-king or warlord), a ruler, **legitimacy** and **unrest**, and five **factions** (farmers, seafarers, warriors, priests, crafters) whose support follows what the people do, believe and fear. When a band grows into a people a faction raises a ruler. Hunger, plague, war, fear of the sky and an illegitimate ruler build unrest; when it peaks the strongest faction out of power rises: it **overthrows the regime**, splits the tribe in **civil war**, or is crushed. Warriors stage coups; chiefs pass power to heirs and warlords leave a struggle. Each year the ruler sets an **objective** (feed the people, defend an exposed village, secure tin or copper, unite the island, ally, reach new land, grow), which steers jobs, building, voyages and war. Strong tribes make weaker neighbours **vassals** that pay tribute, learn their military techs and may break free. Rulers in the Bronze Age raise a great hall or temple.

### The Far Shore test
Boat ladder: log raft → dugout canoe → outrigger → woven sail → star navigation → colony fleet. Each island crossing needs a tier; the Far Shore needs sail and navigation. Losses at sea push the next technology. Endings: *Beyond the horizon* (the Far Shore is reached), *One people*, *The long age* (year 1000) and *Silence*.

## Milestones

| # | Milestone | Proof (automated in `tests/`) |
|---|---|---|
| 0 | Foundation: tick loop, seeded RNG, worker, save/replay | Same seed and actions are identical after 1,000 ticks; `replay()` matches a live run |
| 1 | Archipelago: five islands, sea depth, chunked zoom 1×–30× | Ten seeds all produce the island ladder (raft, canoe, then one too far to see) |
| 2 | Sky: climate, seasons, wind, powers, energy | Rain on drought-struck land raises the harvest within one season |
| 3 | People: founding pairs, births, jobs, crowd sampler, named agents | One man and one woman per island; the people you see match job shares |
| 4 | Sea: boats, routes, voyages, discovery, colonies | Without input the Far Shore is reached on some seeds and not on others |
| 5 | Wrath: storm, quake, eruption, plague | An isolated settlement survives a plague that wipes out a connected one |
| 6 | Kin and war: memory, alliances, raids, wars, belief | A gentle and a cruel sky give different beliefs from the same seed |
| 7 | Polish: sound, onboarding tips, endings, URL seeds | Played in the browser |

## Roadmap: 3D and the ages

| Phase | Status | What |
|---|---|---|
| 1. 3D foundation | **done** | Three.js scene; terrain mesh from the simulation's height function with the painted Living Atlas texture and a sharper detail texture when zoomed; animated ocean with depth, foam and storm waves; sky, sun, stars and a day/night cycle; seasons (autumn gold, winter snow); powers tinting the land; instanced trees, houses (wall material by island), fields, palisades, granaries, 3D Tailfolk, boats, village lights, clouds, eruption smoke; orbit camera. Same simulation and tests. |
| 2. 3D life | **done** | Rigged Tailfolk (hips, shoulders, tail root) with walk cycles and work actions per job (hoeing, hammering, picking, casting, praying, gesturing; children run); island building styles (Hearth brick gables, Kelp reed huts on stilts, Thornholm timber longhouses, Gull Rock round stone houses, Far Shore hide lodges; tents for bands) and landmarks (barn, drying racks, great hall, stone circle, totem); palisades, towers and stone walls; chimney smoke; boat wakes and paddling crews; 3D rain, storm cloud columns and lightning strikes; trade routes and the selected tribe's known world on the sea; follow camera. |
| 3. Resources, ages and politics | **done** | Island deposits and depletion; woodcutters, quarriers, miners and smiths; stockpiles, crafting (brick, bronze), trade and tribute; buildings that cost materials; Early humans, Stone Age and Bronze Age. Governments, factions, legitimacy and unrest; uprisings, coups, civil wars, successions; yearly objectives; vassals; the Bless and Stir revolt powers. People shrunk to scale as solid job-coloured figures; tribe flags, stockpiles, quarries, mines, kilns, forges and temples on the map; government, faction, stockpile and deposit panels in the inspector. |
| 4. Building kits | **done** | Data-driven building kits (`src/render3d/kits.ts`): every island has its own house for each era (shelters, Stone Age huts, Bronze Age houses, multi-storey town houses) plus civic buildings (palace, market, smithy, pier, boat shed, gatehouses, towers, well, brick granary). The wheel, paved roads and town planning; towns of a planning tribe become cities with a street grid (`src/render/plan.ts`), plots that face the street, a palace, temple and market quarter, and houses that grow upward when crowded. Roads between villages follow the land (A* over the terrain) and get better with the wheel and paving; walls get gates where the roads leave town. |
| 5. Ages 4 to 5 | **done** | The Classical age and the Age of Sail: iron and spice, 13 new inventions and their effects, Classical and Age of Sail building kits and civic buildings, ocean ships. The world grows from 16 × 9 to 28 × 15.75 with three new lands and two native peoples, hidden in mist until the first ocean ships sail. |
| 6. Industrial | **done** | Coal and steel; the steam engine, factories, railways, steamships, vaccines, rifles, the telegraph and fertilizer; factory hands; smog over towns and a warming world (CO₂, storms, droughts, harvests, snow line). Terraced houses, mills, pit heads, gasholders, stations, trains, steamships and haze on the map. |
| 7. Ages 7 to 9 | **done** | Electric, Information and Biotech ages; oil and silicon; 15 inventions, scientists, aircraft; late-game powers (Spark of genius, Rising seas, Solar flare) and three new endings; modern and biotech buildings, power stations, turbines, solar fields, airports, planes, cars and a launch pad. |
| 8. Cinematics | planned | Age-dawn flyovers, photo mode, time-lapse replay. |
