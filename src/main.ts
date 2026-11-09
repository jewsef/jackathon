import "./style.css";
import type { World, Action, Fx, ChronEntry, PowerId } from "./sim/types";
import { yearOf, seasonOf } from "./sim/types";
import { getTerrain } from "./sim/terrain";
import { popOf, living } from "./sim/util";
import { POWER } from "./sim/powers";
import type { FromWorker, ToWorker } from "./sim/worker";
import { MapView } from "./render/map";
import { MapView3D } from "./render3d/view";
import { JOB_COLOR, RULER_COLOR, HEAD_COLOR } from "./render3d/actors";
import { LEVELS, visibleWorld, hiddenNames, type Selection, type MapLike } from "./render/common";
import { inHome } from "./sim/terrain";
import { portraitURL } from "./render/sprites";
import { PowersBar } from "./ui/powers";
import { Chronicle } from "./ui/chronicle";
import { renderCard, selectionPos } from "./ui/inspector";
import { Sound } from "./audio";
import tribesData from "../data/tribes.json";

type Snap = Omit<World, "chronicle">;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  sget(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k: string, v: string | null) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* ignore */ } }
};
const SAVE_KEY = "beyond-civilization.save";

function seedFromHash(): number | null {
  const m = location.hash.match(/seed-(\d+)/);
  return m ? Number(m[1]) >>> 0 : null;
}
function randomSeed() { return (Date.now() ^ (Math.random() * 1e9)) % 1000000; }

let toastTimer = 0;
function toast(text: string) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("show"), 3200);
}

async function boot() {
  const seed = seedFromHash() ?? randomSeed();
  if (!seedFromHash()) history.replaceState(null, "", "#seed-" + seed);
  ($("seed-input") as HTMLInputElement).value = String(seed);
  const saved = store.get(SAVE_KEY);
  if (saved) $("btn-continue").hidden = false;

  // intro art: the ten founders
  $("intro-art").innerHTML = (tribesData as any[]).flatMap((t) => [
    `<img alt="" src="${portraitURL({ tribe: t, sex: "m" }, 140)}">`, `<img alt="" src="${portraitURL({ tribe: t, sex: "f" }, 140)}">`
  ]).join("");

  const pendingLoad = store.sget("bc.loadNow");
  if (pendingLoad) { store.sset("bc.loadNow", null); $("intro").hidden = true; start(seed, true); return; }

  $("btn-begin").addEventListener("click", () => {
    const v = Number(($("seed-input") as HTMLInputElement).value) >>> 0;
    if (v !== seed) { location.hash = "seed-" + v; location.reload(); return; }
    $("intro").hidden = true; start(seed, false);
  });
  $("btn-continue").addEventListener("click", () => loadSaved());
}

function loadSaved() {
  const raw = store.get(SAVE_KEY);
  if (!raw) { toast("No saved world found in this browser."); return; }
  const data = JSON.parse(raw);
  store.sset("bc.loadNow", "1");
  location.hash = "seed-" + data.seed;
  location.reload();
}

async function start(seed: number, fromSave: boolean) {
  const terrain = getTerrain(seed);
  const use3D = store.get("bc.view") !== "2d";
  $("loading").hidden = false;
  const map: MapLike = use3D ? new MapView3D($("map"), terrain, store.get("bc.quality") === "low" ? "low" : "high") : new MapView($("map"), terrain);
  await map.init();
  $("loading").hidden = true;
  const viewBtn = $("btn-view"); viewBtn.textContent = use3D ? "2D map" : "3D view";
  viewBtn.addEventListener("click", () => { store.set("bc.view", use3D ? "2d" : "3d"); location.reload(); });
  const dayBtn = $("btn-day");
  if (map instanceof MapView3D) {
    const m3 = map;
    if (store.get("bc.daycycle") === "off") m3.setDayCycle(false);
    const sync = () => { dayBtn.textContent = m3.dayCycleOn() ? "Day/night: on" : "Day/night: off"; dayBtn.setAttribute("aria-pressed", String(m3.dayCycleOn())); };
    sync();
    dayBtn.addEventListener("click", () => { m3.setDayCycle(!m3.dayCycleOn()); store.set("bc.daycycle", m3.dayCycleOn() ? "on" : "off"); sync(); });
  } else dayBtn.hidden = true;
  const sound = new Sound();
  if (store.get("bc.sound") !== "off") { sound.start(); }
  const syncSoundBtn = () => { const b = $("btn-sound"); b.setAttribute("aria-pressed", String(sound.on)); b.textContent = sound.on ? "Sound on" : "Sound off"; };
  syncSoundBtn();

  const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
  const send = (m: ToWorker) => worker.postMessage(m);
  let world: Snap | null = null, sel: Selection = null, lastCard = 0, endingsSeen = 0, speed = 1;
  const chron = new Chronicle($("chron-list"), $("log-full"));
  let cardHold = false;
  $("card").addEventListener("pointerdown", () => { cardHold = true; });
  window.addEventListener("pointerup", () => setTimeout(() => { cardHold = false; }, 60));
  chron.onGo = (x, y) => { if (map instanceof MapView3D) map.follow(null); map.flyTo(x, y, Math.max(map.cam.z, 3)); };
  const powers = new PowersBar($("powers"));

  // ---- worker messages
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "snap") {
      world = m.world;
      const hide = hiddenNames(world);
      chron.hidden = hide;
      if (m.reset && m.chronicle) { chron.reset(m.chronicle); endingsSeen = world.endings.length; }
      else chron.add(m.entries);
      chron.setHidden(hide);
      const seen = (x?: number, y?: number) => world!.horizon || x === undefined || y === undefined || inHome(x, y);
      const fx = m.fx.filter((f) => seen(f.x, f.y));
      map.setWorld(visibleWorld(world), fx);
      hud(); react(fx, m.entries.filter((e) => seen(e.x, e.y) && !hide.some((n) => e.text.includes(n))));
      if (!cardHold && performance.now() - lastCard > 400) { lastCard = performance.now(); renderCard($("card"), world, sel, terrain); }
      if (world.endings.length > endingsSeen) {
        const end = world.endings[world.endings.length - 1]; endingsSeen = world.endings.length;
        $("ending-when").textContent = `Year ${yearOf(end.tick)}`; $("ending-title").textContent = end.title; $("ending-text").textContent = end.text;
        $("ending").hidden = false; setSpeed(0);
      }
    } else if (m.type === "saved") {
      if (store.set(SAVE_KEY, JSON.stringify({ seed: m.seed, log: m.log, tick: m.tick, at: Date.now() }))) toast(`Saved: Year ${yearOf(m.tick)}, ${m.log.length} acts of the sky. Replays exactly from the seed.`);
      else toast("This browser blocked saving. Use Share seed to keep the world.");
    }
  };
  if (fromSave) {
    const data = JSON.parse(store.get(SAVE_KEY) ?? "{}");
    send({ type: "init", seed, log: data.log as Action[], toTick: data.tick });
    toast("Replaying your saved world from its seed…");
  } else send({ type: "init", seed });
  send({ type: "speed", value: 1 });

  function hud() {
    if (!world) return;
    $("date").textContent = `Year ${yearOf(world.tick)} · ${seasonOf(world.tick)}`;
    const e = world.energy;
    ($("energy-bar") as HTMLElement).style.width = Math.min(100, (e / 40) * 100) + "%";
    $("energy-num").textContent = String(Math.floor(e));
    $("faith").textContent = String(Math.round(world.faith));
    $("st-pop").textContent = living(world as World).reduce((s, v) => s + popOf(v), 0).toLocaleString("en-US");
    $("st-tribes").textContent = String(world.tribes.filter((t) => t.alive).length);
    $("st-villages").textContent = String(living(world as World).length);
    powers.setEnergy(e);
    let rain = 0, storm = false;
    for (const ef of world.effects) { if (ef.power === "rain") rain = 1; if (ef.power === "storm") storm = true; }
    sound.weather(rain, storm, map.cam.z);
  }
  function react(fx: Fx[], entries: ChronEntry[]) {
    const kinds = new Set(fx.map((f) => f.kind));
    if (kinds.has("lightning")) sound.thunder();
    if (kinds.has("quake") || kinds.has("eruption")) sound.boom();
    if (kinds.has("plague")) sound.sick();
    if (kinds.has("battle")) sound.drum();
    if (kinds.has("found")) sound.bell();
    if (entries.some((x) => x.kind === "tech")) sound.chime();
    const big = entries.find((x) => x.kind === "contact" && x.text.startsWith("First contact")) ?? entries.find((x) => x.kind === "voyage" && x.text.includes("there is land"));
    if (big) toast(big.text);
  }

  // ---- powers
  const armedEl = $("armed");
  powers.onArm = (p: PowerId | null) => {
    map.armed = p ? { power: p, radius: POWER[p].radius } : null;
    armedEl.hidden = !p;
    if (p) armedEl.textContent = `${POWER[p].name}: click the map${p === "plague" || p === "omen" ? " on a village" : ""}. Esc to cancel.`;
  };
  map.onCast = (x, y) => {
    const p = powers.armed; if (!p || !world) return;
    if (world.energy < POWER[p].cost) { toast(`Not enough energy for ${POWER[p].name}. Faith refills it.`); return; }
    if ((p === "plague" || p === "omen") && !world.villages.some((v) => !v.lost && Math.hypot(v.x - x, v.y - y) < (p === "omen" ? 1.2 : 0.8))) { toast("Click closer to a village."); return; }
    send({ type: "act", action: { power: p, x, y, strain: p === "plague" ? powers.strain : undefined } });
    powers.arm(null);
  };
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "Escape") { powers.arm(null); $("logmodal").hidden = true; if (map instanceof MapView3D) map.follow(null); }
    if (e.key === " ") { e.preventDefault(); setSpeed(speed === 0 ? 1 : 0); }
    if (e.key.startsWith("Arrow") && !(map instanceof MapView3D)) e.preventDefault();
  });

  // ---- selection + inspector
  const select = (s: Selection, fly = false) => {
    sel = s; map.selection = s; map.refresh();
    if (world) renderCard($("card"), world, sel, terrain);
    if (fly && world) { const pos = selectionPos(world, s, terrain); if (pos) map.flyTo(pos[0], pos[1], Math.max(map.cam.z, s?.kind === "agent" ? 14 : 3)); }
  };
  map.onSelect = (s) => select(s);
  $("card").addEventListener("click", (e) => {
    const fb = (e.target as HTMLElement).closest("[data-follow]");
    if (fb && sel && world) {
      const target = sel;
      if (map instanceof MapView3D) {
        map.follow(() => (world ? selectionPos(world, target, terrain) : null));
        const p0 = selectionPos(world, target, terrain);
        if (p0) map.flyTo(p0[0], p0[1], Math.max(map.cam.z, target.kind === "village" ? 6 : 12));
        toast("Following. Move the camera or press Esc to stop.");
      } else { const p0 = selectionPos(world, target, terrain); if (p0) map.flyTo(p0[0], p0[1], Math.max(map.cam.z, 8)); }
      return;
    }
    const b = (e.target as HTMLElement).closest("[data-sel]") as HTMLElement | null;
    if (!b) return;
    const [k, id] = b.dataset.sel!.split(":");
    if (k === "none") select(null);
    else if (k === "tribe") select({ kind: "tribe", id: +id });
    else if (k === "agent") select({ kind: "agent", id: +id }, true);
  });

  // ---- zoom ladder, scale bar
  const ladder = $("ladder");
  ladder.innerHTML = LEVELS.map((l, i) => `<button type="button" class="rung" data-i="${i}"><span class="dot"></span><span>${l.name}</span><span class="zz">${l.z}×</span></button>`).join("");
  ladder.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest(".rung") as HTMLElement | null; if (b) map.flyTo(map.cam.x, map.cam.y, LEVELS[+b.dataset.i!].z); });
  const LEGEND = `<span class="legend">${[["farmer", "Farmer"], ["fisher", "Fisher"], ["gatherer", "Gatherer"], ["woodcutter", "Woodcutter"], ["quarrier", "Quarrier"], ["miner", "Miner"], ["smith", "Smith"], ["builder", "Builder"], ["warrior", "Warrior"], ["priest", "Priest"], ["doctor", "Doctor"], ["boatwright", "Boatwright"], ["leader", "Leader"], ["child", "Child"]].map(([j, n]) => `<span><i class="swatch" style="background:${JOB_COLOR[j]}"></i>${n}</span>`).join("")}<span><i class="swatch" style="background:${RULER_COLOR}"></i>Ruler</span><span><i class="swatch" style="background:${HEAD_COLOR}"></i>Faction head</span></span>`;
  const NOTES = [
    "<b>Each village is a light.</b> Brightness is population. Work the weather and watch voyages here.",
    "<b>Villages become roofs and fields.</b> Their number comes straight from each village's record.",
    "<b>People appear</b> as small figures coloured by their work. They are drawn from the village's numbers: fishers walk to the shore, miners uphill." + LEGEND,
    "<b>Named people</b> wear a ring. Gold figures are rulers, orange are faction heads. Click one." + LEGEND
  ];
  let lvl = -1;
  map.onCamera = () => {
    const l = map.level();
    if (l !== lvl) { lvl = l; ladder.querySelectorAll(".rung").forEach((r, i) => r.classList.toggle("on", i === l)); $("levelnote").innerHTML = NOTES[l]; }
    const sb = map.scaleBar(); ($("scale-bar") as HTMLElement).style.width = sb.px + "px"; $("scale-label").textContent = sb.label;
  };
  map.onCamera();
  $("zin").addEventListener("click", () => map.zoomBy(1.6));
  $("zout").addEventListener("click", () => map.zoomBy(1 / 1.6));

  // ---- speed
  const setSpeed = (v: number) => {
    speed = v; send({ type: "speed", value: v });
    document.querySelectorAll<HTMLElement>(".sp").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.speed! === v)));
  };
  document.querySelectorAll<HTMLElement>(".sp").forEach((b) => b.addEventListener("click", () => setSpeed(+b.dataset.speed!)));

  // ---- menu
  $("btn-save").addEventListener("click", () => send({ type: "save" }));
  $("btn-load").addEventListener("click", () => loadSaved());
  $("btn-new").addEventListener("click", () => { location.hash = "seed-" + randomSeed(); location.reload(); });
  $("btn-share").addEventListener("click", async () => {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); toast("Link copied. Anyone who opens it gets this same archipelago."); }
    catch { toast(`Seed ${seed}. Share this page address: ${url}`); }
  });
  $("btn-sound").addEventListener("click", () => { if (sound.on) { sound.stop(); store.set("bc.sound", "off"); } else { sound.start(); store.set("bc.sound", "on"); } syncSoundBtn(); });
  $("btn-keep").addEventListener("click", () => { $("ending").hidden = true; setSpeed(1); });
  document.querySelectorAll<HTMLElement>(".flt").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".flt").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    chron.setFilter(b.dataset.f!);
  }));
  $("chron-list").addEventListener("dblclick", () => { chron.renderFull(); $("logmodal").hidden = false; });
  $("btn-closelog").addEventListener("click", () => { $("logmodal").hidden = true; });

  // ---- tips (onboarding)
  const TIPS = [
    "Five islands, five tribes, one man and one woman on each. The first 40 years are fragile: one death can end a tribe. Gentle weather helps.",
    "Move with WASD or the arrow keys, zoom with the wheel, right-drag to look around. Push the mouse to the map edge to scroll, or click the minimap. Villages turn into houses, then people.",
    "Pick a power on the left, then click the map. Rain feeds them, an east wind pushes boats, storms and plague test them.",
    "Your energy refills from their faith. Sky-speakers and awe make it grow faster.",
    "The chronicle below tells their history. Click a line to fly there, double-click for the whole book. Space pauses."
  ];
  let tipI = 0;
  const showTip = () => {
    if (tipI >= TIPS.length) { $("tip").hidden = true; store.set("bc.tips", "done"); return; }
    $("tip").hidden = false; $("tip-text").textContent = TIPS[tipI]; $("tip-step").textContent = `${tipI + 1} / ${TIPS.length}`;
    $("tip-next").textContent = tipI === TIPS.length - 1 ? "Play" : "Next";
  };
  $("tip-next").addEventListener("click", () => { tipI++; showTip(); });
  $("btn-help").addEventListener("click", () => { tipI = 0; showTip(); });
  if (store.get("bc.tips") !== "done" && !fromSave) showTip();

  (window as any).__bc = { map, get world() { return world; }, send };
  // keep the inspector following a moving selection
  setInterval(() => { if (world && sel && !cardHold) renderCard($("card"), world, sel, terrain); }, 1000);
}

void boot();
