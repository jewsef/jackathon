import type { World, Village, Tribe, Agent } from "../sim/types";
import { JOBS, yearOf } from "../sim/types";
import type { Terrain } from "../sim/terrain";
import { popOf, kids, tribePop, boatTier, relation, TECH } from "../sim/util";
import { STRAINS } from "../sim/powers";
import { voyagePos } from "../sim/voyages";
import { portraitURL } from "../render/sprites";
import type { Selection } from "../render/map";
import jobsData from "../../data/jobs.json";
import resData from "../../data/resources.json";
import agesData from "../../data/ages.json";
import { REGIMES, FACTION_INFO } from "../sim/politics";
import { RES } from "../sim/types";
import { isPlanned, roadTier } from "../render/plan";
import { JOB_COLOR, RULER_COLOR, HEAD_COLOR } from "../render3d/actors";

type Snap = Omit<World, "chronicle">;
const JOBNAME: Record<string, string> = Object.fromEntries(jobsData.map((j) => [j.id, j.name]));
const RESINFO: Record<string, { name: string; color: string }> = Object.fromEntries(resData.map((r) => [r.id, r]));
const POLICY: Record<string, string> = { growth: "grow the fields", defense: "arm and fortify", sea: "boats and trade", faith: "feed the sky", craft: "tools and building" };
function stockList(stock: Record<string, number>, scale: number) {
  const rows = RES.filter((r) => stock[r] >= 0.5);
  if (!rows.length) return '<span class="sub">nothing stored</span>';
  return `<div class="jobs">${rows.map((r) => `<div class="jobrow"><span><i class="swatch" style="background:${RESINFO[r].color}"></i>${RESINFO[r].name}</span>${bar(stock[r] / scale, RESINFO[r].color)}<span>${fmt(stock[r])}</span></div>`).join("")}</div>`;
}
const BOAT = ["no boats", "log rafts", "dugout canoes", "outriggers", "sail-canoes", "sail and star navigation"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const pct = (x: number) => Math.round(x * 100) + "%";
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function bar(x: number, color = "var(--storm)") { return `<div class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%;background:${color}"></i></div>`; }
const ROLE_JOB: Record<string, string> = { Leader: "leader", "Sky-speaker": "priest", Doctor: "doctor", "War leader": "warrior", Boatwright: "boatwright", Navigator: "priest", Founder: "gatherer", Captain: "boatwright", Voyager: "fisher", "Village founder": "builder", Veteran: "warrior" };

export function agentAge(w: Snap, a: Agent) { return Math.floor(((a.died ?? w.tick) - a.born) / 4); }

function tribeLink(t: Tribe) { return `<button type="button" class="link" data-sel="tribe:${t.id}">${esc(t.name)}</button>`; }

function villageCard(w: Snap, v: Village, terrain: Terrain): string {
  const t = w.tribes[v.tribe], pop = popOf(v);
  if (v.lost) return `<span class="kind">Village · lost</span><h3>${esc(v.name)}</h3><p class="sub">${terrain.byId[v.isle].name} · ${v.lostReason === "plague" ? "wiped out by plague" : "abandoned"}. Only a cold ring remains on the map.</p>`;
  const blood = Object.entries(v.blood).filter(([, x]) => x > 0.01).sort((a, b) => b[1] - a[1]);
  const named = w.agents.filter((a) => a.alive && a.village === v.id);
  return `<span class="kind">Village · one aggregate record</span>
  <h3>${esc(v.name)}</h3>
  <p class="sub">${tribeLink(t)} · ${terrain.byId[v.isle].name} · ${v.stage}${v.coastal ? " · coast" : ""}</p>
  <dl>
    <dt>People</dt><dd>${fmt(pop)} <span class="sub">(${v.men} men, ${v.women} women, ${kids(v)} children, ${v.elders} elders)</span></dd>
    <dt>Food stores</dt><dd>${fmt(v.food)}${bar(v.food / Math.max(1, pop * 1.5))}</dd>
    <dt>Morale</dt><dd>${pct(v.morale)}${bar(v.morale, "var(--ember)")}</dd>
    <dt>Kinship</dt><dd>${v.kin > 0.35 ? "everyone is cousins; must marry out" : v.kin > 0.2 ? "closely related" : "varied families"}${bar(v.kin, "#c98fd0")}</dd>
    <dt>Bloodlines</dt><dd><div class="blood">${blood.map(([k, x]) => `<i title="${esc(w.tribes[+k]?.name ?? "")}" style="width:${x * 100}%;background:${w.tribes[+k]?.tail ?? "#888"}"></i>`).join("")}</div></dd>
    <dt>Layout</dt><dd>${isPlanned(v, t) ? "planned streets, a market and a palace quarter" : v.stage === "band" ? "a camp of shelters" : "grown house by house"} · ${["footpaths", "cart tracks", "paved roads"][roadTier(t)]}</dd>
    <dt>Buildings</dt><dd>${Math.floor(v.houses)} houses${v.granary >= 1 ? ", granary" : ""}${Math.floor(v.defense) ? `, defences tier ${Math.floor(v.defense)}` : ""}${v.monument >= 1 ? ", a great temple" : v.monument > 0.02 ? `, temple ${pct(v.monument)} built` : ""}</dd>
    ${v.sick ? `<dt>Sickness</dt><dd style="color:var(--blight)">${STRAINS[v.sick.strain].name}, season ${v.sick.t + 1}</dd>` : v.immune > 0.2 ? `<dt>Immunity</dt><dd>${pct(v.immune)} of the village</dd>` : ""}
    ${v.threat ? `<dt>Threat</dt><dd style="color:var(--blight)">${v.threat >= 1 ? "at war" : "hostile neighbours"}</dd>` : ""}
  </dl>
  <div><div class="eyebrow" style="margin-bottom:6px">Stockpile</div>${stockList(v.stock, 60 + v.houses * 6 + v.granary * 40)}</div>
  <div><div class="eyebrow" style="margin-bottom:6px">Jobs <span class="sub">(figure colours)</span></div><div class="jobs">${JOBS.filter((j) => v.jobs[j] > 0.005).map((j) => `<div class="jobrow"><span><i class="swatch" style="background:${JOB_COLOR[j] ?? "#ccc"}"></i>${JOBNAME[j]}</span>${bar(v.jobs[j] * 2)}<span>${pct(v.jobs[j])}</span></div>`).join("")}</div></div>
  ${named.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Named people</div>${named.map((a) => `<button type="button" class="link" data-sel="agent:${a.id}">${esc(a.name)}</button> <span class="sub">${a.role}</span>`).join("<br>")}</div>` : ""}
  <p class="why"><b>Simulated as numbers.</b> The houses, fields and people you see when you zoom in are drawn from this record.</p>`;
}

function agentCard(w: Snap, a: Agent): string {
  const t = w.tribes[a.tribe], v = w.villages.find((x) => x.id === a.village), voy = w.voyages.find((x) => x.captain === a.id);
  const age = agentAge(w, a);
  const img = portraitURL({ tribe: t, sex: a.sex, job: ROLE_JOB[a.role] ?? "", age: age >= 55 ? "elder" : "adult" }, 140);
  return `<span class="kind person">Named person · individual agent</span>
  <div class="portrait"><img src="${img}" alt=""><div><h3>${esc(a.name)}</h3><p class="sub">${esc(a.role)} · ${voy ? "at sea" : v ? esc(v.name) : ""} · ${a.alive ? "age " + age : "died aged " + age}</p><p class="sub">${tribeLink(t)}</p></div></div>
  ${a.alive ? `<p class="quote">${esc(a.goal)}</p>` : `<p class="quote">Remembered in the chronicle.</p>`}
  <dl><dt>Believes</dt><dd>${t.belief.fear > t.belief.love ? "The sky must be feared and fed." : t.belief.awe > 0.5 ? "The sky speaks through signs." : "The sky is kind to the patient."}</dd>
  ${a.founder ? "<dt>Founder</dt><dd>One of the first two people on the island</dd>" : ""}</dl>
  ${a.memory.length ? `<div><div class="eyebrow" style="margin-bottom:4px">Remembers</div><ul class="mem">${a.memory.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
  <p class="why"><b>Why simulated one by one:</b> ${{ Founder: "a founding parent of the tribe", Leader: "decides jobs, war and peace", "Sky-speaker": "interprets your powers and omens", Navigator: "star navigation depends on them", Captain: "commands a voyage; their skill cuts the risk", Doctor: "fights the plague", "War leader": "leads the war", Speaker: "lets two peoples talk without mistakes", Boatwright: "first to build a new kind of boat", "Village founder": "led families to a new village", Voyager: "came back from a voyage" }[a.role] ?? "the story needs a face here"}.</p>`;
}

function govBlock(w: Snap, t: Tribe): string {
  const g = t.gov, R = REGIMES[g.type], ruler = g.ruler !== null ? w.agents.find((a) => a.id === g.ruler && a.alive) : undefined;
  const lord = w.relations.find((r) => r.overlord !== null && r.overlord !== t.id && (r.a === t.id || r.b === t.id));
  const vass = w.relations.filter((r) => r.overlord === t.id).map((r) => w.tribes[r.a === t.id ? r.b : r.a]);
  const years = Math.floor((w.tick - g.since) / 4);
  return `<div><div class="eyebrow" style="margin-bottom:4px">Government</div>
  <dl><dt>Regime</dt><dd title="${esc(R.desc)}">${R.name}${years ? ` <span class="sub">for ${years} years</span>` : ""}</dd>
  <dt>${R.ruler}</dt><dd>${ruler ? `<i class="swatch" style="background:${RULER_COLOR}"></i><button type="button" class="link" data-sel="agent:${ruler.id}">${esc(ruler.name)}</button>` : '<span class="sub">no one holds power</span>'}${g.rulerFaction ? ` <span class="sub">of the ${FACTION_INFO[g.rulerFaction].name.toLowerCase()}</span>` : ""}</dd>
  <dt>Legitimacy</dt><dd>${bar(g.legitimacy, "var(--ember)")}</dd>
  <dt>Unrest</dt><dd>${bar(g.unrest, "var(--blight)")}${g.unrest > 0.6 ? '<span class="sub" style="color:var(--blight)"> close to revolt</span>' : ""}</dd>
  <dt>Policy</dt><dd>${POLICY[g.policy] ?? g.policy}</dd>
  ${t.objective ? `<dt>Objective</dt><dd>${esc(t.objective.text)}</dd>` : ""}
  ${lord ? `<dt>Pays tribute</dt><dd>to the ${tribeLink(w.tribes[lord.overlord!])}</dd>` : ""}
  ${vass.length ? `<dt>Vassals</dt><dd>${vass.map(tribeLink).join(", ")}</dd>` : ""}
  ${g.uprisings ? `<dt>Uprisings</dt><dd>${g.uprisings}</dd>` : ""}</dl>
  <div class="jobs">${t.factions.map((f) => { const h = f.head !== null ? w.agents.find((a) => a.id === f.head && a.alive) : undefined; return `<div class="jobrow" title="${h ? esc(FACTION_INFO[f.id].head + ": " + h.name) : ""}"><span>${h ? `<i class="swatch" style="background:${HEAD_COLOR}"></i>` : ""}${FACTION_INFO[f.id].name}${f.militancy > 0.5 ? " ⚑" : ""}</span>${bar(f.support, f.id === g.rulerFaction ? RULER_COLOR : "var(--storm)")}<span>${pct(f.support)}</span></div>`; }).join("")}</div></div>`;
}

function tribeCard(w: Snap, t: Tribe, terrain: Terrain): string {
  const pop = tribePop(w as World, t.id), vs = w.villages.filter((v) => v.tribe === t.id && !v.lost);
  const rels = w.tribes.filter((o) => o.id !== t.id && o.alive).map((o) => ({ o, r: relation(w as World, t.id, o.id) })).filter((x) => x.r.met);
  return `<span class="kind">Tribe</span><h3>${esc(t.name)}</h3>
  <p class="sub">Home: ${terrain.byId[t.home].name}${t.parent !== null ? ` · broke away from the ${esc(w.tribes[t.parent].name)}` : ""}</p>
  <dl><dt>Age</dt><dd>${agesData[t.age]?.name ?? "?"}</dd>
  <dt>People</dt><dd>${fmt(pop)} in ${vs.length} ${vs.length === 1 ? "village" : "villages"}</dd>
  <dt>Boats</dt><dd>${BOAT[boatTier(t)]}</dd>
  <dt>Knows</dt><dd>${t.known.map((k) => terrain.byId[k].name).join(", ")}</dd>
  <dt>Awe</dt><dd>${bar(t.belief.awe, "var(--storm)")}</dd><dt>Fear</dt><dd>${bar(t.belief.fear, "var(--blight)")}</dd><dt>Love</dt><dd>${bar(t.belief.love, "var(--ember)")}</dd></dl>
  ${govBlock(w, t)}
  <div><div class="eyebrow" style="margin-bottom:6px">Stores</div>${stockList(Object.fromEntries(RES.map((r) => [r, vs.reduce((a, v) => a + v.stock[r], 0)])), 60 * Math.max(1, vs.length) + vs.reduce((a, v) => a + v.houses * 6, 0))}</div>
  <div>${t.techs.map((x) => `<span class="chip tech">${TECH[x].name}</span>`).join("") || '<span class="sub">No inventions yet.</span>'}</div>
  ${rels.length ? `<div><div class="eyebrow" style="margin-bottom:4px">Relations</div>${rels.map(({ o, r }) => `<div>${tribeLink(o)} <span class="chip ${r.war ? "war" : r.alliance ? "ally" : ""}">${r.war ? "at war" : r.alliance ? "allied" : r.attitude > 0.3 ? "friendly" : r.attitude < -0.3 ? "hostile" : "wary"}</span>${r.marriages ? `<span class="chip">${r.marriages} marriages</span>` : ""}</div>`).join("")}</div>` : ""}
  ${t.memory.length ? `<div><div class="eyebrow" style="margin-bottom:4px">They remember</div><ul class="mem">${t.memory.slice(0, 6).map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}`;
}

function isleCard(w: Snap, id: string, terrain: Terrain): string {
  const I = terrain.byId[id as keyof typeof terrain.byId];
  const people = w.tribes.filter((t) => t.alive && w.villages.some((v) => v.tribe === t.id && v.isle === I.id && !v.lost));
  const fromHearth = I.id === "hearth" ? null : terrain.crossing("hearth", I.id);
  const dep = w.deposits?.[I.id], base = w.depositBase?.[I.id];
  return `<span class="kind">Island</span><h3>${I.name}</h3>
  <dl><dt>Resource</dt><dd>${I.resource}</dd><dt>Living here</dt><dd>${people.map(tribeLink).join(", ") || "no one"}</dd>
  ${fromHearth ? `<dt>From Hearth</dt><dd>about ${Math.round(fromHearth.dist * 8)} km of sea; needs ${BOAT[Math.min(5, fromHearth.tier)]}</dd>` : ""}
  <dt>Known to</dt><dd>${w.tribes.filter((t) => t.alive && t.known.includes(I.id)).map((t) => esc(t.name)).join(", ")}</dd></dl>
  ${dep ? `<div><div class="eyebrow" style="margin-bottom:6px">Deposits <span class="sub">(what is left)</span></div><div class="jobs">${RES.filter((r) => (base?.[r as keyof typeof base] ?? 0) > 0.05).map((r) => `<div class="jobrow"><span><i class="swatch" style="background:${RESINFO[r].color}"></i>${RESINFO[r].name}</span>${bar((dep[r as keyof typeof dep] ?? 0) / 1.6, RESINFO[r].color)}<span>${(dep[r as keyof typeof dep] ?? 0).toFixed(1)}</span></div>`).join("")}</div></div>` : ""}`;
}

function voyageCard(w: Snap, id: number, terrain: Terrain): string {
  const v = w.voyages.find((x) => x.id === id);
  if (!v) return `<p class="sub">This voyage has ended. Check the chronicle.</p>`;
  const t = w.tribes[v.tribe], from = w.villages.find((x) => x.id === v.from), cap = w.agents.find((a) => a.id === v.captain);
  return `<span class="kind person">Voyage</span><h3>A ${["log", "raft", "dugout canoe", "outrigger", "sail-canoe", "star-guided sail-canoe"][v.tier]}</h3>
  <dl><dt>From</dt><dd>${esc(from?.name ?? "?")} · ${tribeLink(t)}</dd><dt>Bound for</dt><dd>${terrain.byId[v.target].name}</dd>
  <dt>Purpose</dt><dd>${{ explore: "explore", trade: "trade", marriage: "find partners", colony: "found a colony", drift: "blown off course", raid: "raid" }[v.purpose]}</dd>
  <dt>Aboard</dt><dd>${v.crew} crew${v.settlers ? `, ${v.settlers} settlers` : ""}</dd><dt>Leg</dt><dd>${v.leg === "out" ? "outbound" : "coming home"} · ${pct(v.progress)}</dd>
  ${cap ? `<dt>Captain</dt><dd><button type="button" class="link" data-sel="agent:${cap.id}">${esc(cap.name)}</button></dd>` : ""}</dl>`;
}

export function overviewCard(w: Snap): string {
  const alive = w.tribes.filter((t) => t.alive || tribePop(w as World, t.id) > 0);
  return `<span class="kind">The archipelago · Year ${yearOf(w.tick)}</span>
  <div class="tribes">${w.tribes.map((t) => {
    const pop = tribePop(w as World, t.id), dead = !t.alive && pop === 0;
    const wars = w.relations.filter((r) => r.war && (r.a === t.id || r.b === t.id)).length;
    return `<button type="button" class="trow${dead ? " dead" : ""}" data-sel="tribe:${t.id}"><span class="dot" style="background:${t.tail}"></span><span>${esc(t.name)}${wars ? ' <span class="chip war">war</span>' : ""}</span><span class="r">${dead ? "gone" : fmt(pop)}</span></button>`;
  }).join("")}</div>
  <p class="why">${alive.length} tribes. Click one for its beliefs, inventions and relations, or click the map.</p>`;
}

export function renderCard(el: HTMLElement, w: Snap, sel: Selection, terrain: Terrain) {
  let html = "";
  if (!sel) html = overviewCard(w);
  else if (sel.kind === "village") { const v = w.villages.find((x) => x.id === sel.id); html = v ? villageCard(w, v, terrain) : overviewCard(w); }
  else if (sel.kind === "agent") { const a = w.agents.find((x) => x.id === sel.id); html = a ? agentCard(w, a) : overviewCard(w); }
  else if (sel.kind === "tribe") html = tribeCard(w, w.tribes[sel.id], terrain);
  else if (sel.kind === "isle") html = isleCard(w, sel.id, terrain);
  else if (sel.kind === "voyage") html = voyageCard(w, sel.id, terrain);
  if (sel && (sel.kind === "agent" || sel.kind === "voyage" || sel.kind === "village")) html += `<p><button type="button" class="ghost followbtn" data-follow="1">Follow with the camera</button></p>`;
  if (sel) html += `<p><button type="button" class="link" data-sel="none">Back to all tribes</button></p>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

export function selectionPos(w: Snap, sel: Selection, terrain: Terrain): [number, number] | null {
  if (!sel) return null;
  if (sel.kind === "village") { const v = w.villages.find((x) => x.id === sel.id); return v ? [v.x, v.y] : null; }
  if (sel.kind === "agent") {
    const a = w.agents.find((x) => x.id === sel.id); if (!a) return null;
    const voy = w.voyages.find((x) => x.captain === a.id); if (voy) return voyagePos(voy);
    const v = w.villages.find((x) => x.id === a.village); return v ? [v.x, v.y] : null;
  }
  if (sel.kind === "isle") { const I = terrain.byId[sel.id]; return [I.cx, I.cy]; }
  if (sel.kind === "voyage") { const v = w.voyages.find((x) => x.id === sel.id); return v ? voyagePos(v) : null; }
  return null;
}
