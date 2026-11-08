# Beyond Civilization

A god game of indirect control, played in the browser.

Five islands. Five tribes, each grown from **one man and one woman**. You never give orders: you command the sky, the sea and the sickness, and the people decide what to do about it. They marry, work, invent boats, feud, fight and fall sick. The long test is whether anyone ever crosses the deep sea to **the Far Shore**.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static game in dist/ (open dist/index.html through any static server)
npm test           # simulation and milestone tests
```

- **3D view** (default, desktop): scroll to zoom from the whole archipelago down to individual people, drag to pan, **right-drag or Shift-drag to orbit and tilt**, Q/E to rotate, R to reset north. **Day/night** toggles the day cycle; at night village hearths light the islands.
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
| Drought | 4 | Fields fail. Hunger pushes raids, migration and new ideas. |
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
Jobs: gatherer, farmer, fisher, builder, leader, doctor, sky-speaker, warrior, boatwright (plus elders). Shares shift each season toward the biggest need. Settlements grow through band → camp → village → town. Small islands become one family within a few generations (**kinship**), so tribes must **marry out** across the sea. Marriages mix bloodlines (tail colours) and build alliances. Scarcity, plague blame, crowding and ambitious leaders cause raids and wars; weapons and defences (bow, palisade, shield wall, war canoe, stone fort) are only built under threat.

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
| 2. 3D life | next | Walk and work animations, building variety per tribe, boat wakes, volumetric storms, follow-cam. |
| 3. Ages foundation | planned | Island resources (grain and clay/brick on Hearth, fish and salt on Kelp Isle, hardwood on Thornholm, stone and herbs on Gull Rock, flint, copper and later coal and oil on the Far Shore); stockpiles; buildings that cost resources; resource affinity for research; depletion. Ages 1 to 3 (early humans to Bronze). |
| 4. Building kits | planned | Procedural 3D buildings per age and tribe; cities and roads on the terrain. |
| 5. Ages 4 to 5 | planned | Classical and Age of Sail; the world grows when ocean ships arrive. |
| 6. Industrial | planned | Factories, coal, rail, steamships, vaccines, pollution and climate. |
| 7. Ages 7 to 9 | planned | Electricity, computers, flight, biotech enhancements, late-game powers and endings. |
| 8. Cinematics | planned | Age-dawn flyovers, photo mode, time-lapse replay. |
