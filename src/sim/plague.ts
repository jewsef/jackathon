import type { World, Village, StrainId } from "./types";
import type { Rng } from "./rng";
import { living, popOf, kill, chron, has, relation, remember, workers, agentsOf, villageById } from "./util";
import { STRAINS } from "./powers";

function infect(w: World, target: Village, src: Village, strain: StrainId, via: string) {
  target.sick = { strain, t: 0, startPop: popOf(target), from: src.id };
  w.fx.push({ kind: "plague", x: target.x, y: target.y, tick: w.tick });
  chron(w, "plague", `${STRAINS[strain].name} reaches ${target.name} ${via} from ${src.name}.`, target.x, target.y);
  if (src.tribe !== target.tribe) {
    const r = relation(w, src.tribe, target.tribe);
    r.grudge = Math.min(1, r.grudge + 0.35); r.attitude = Math.max(-1, r.attitude - 0.3);
    remember(w.tribes[target.tribe], `Y${Math.floor(w.tick / 4)}: the ${w.tribes[src.tribe].name} brought ${STRAINS[strain].name}`);
  }
}

/** Spread only along contact: island paths, routes, voyages and raids. Doctors and immunity cut deaths. */
export function plague(w: World, rng: Rng): World {
  const newly: { v: Village; src: Village; strain: StrainId; via: string }[] = [];
  const sickNow = living(w).filter((v) => v.sick);
  for (const v of sickNow) {
    const s = v.sick!, S = STRAINS[s.strain], t = w.tribes[v.tribe], pop = popOf(v);
    const docShare = workers(v, "doctor") / Math.max(1, pop);
    const docAgent = agentsOf(w, (a) => a.village === v.id && a.role === "Doctor").length > 0;
    const docF = (1 - Math.min(0.5, docShare * 6)) * (has(t, "herbs") ? 0.75 : 1) * (docAgent ? 0.85 : 1) * (has(t, "aqueduct") && (v.stage === "town" || v.stage === "city") ? 0.7 : 1);
    kill(v, rng.binom(pop, S.mort * docF * (1 - v.immune)), rng);
    const qSrc = has(t, "quarantine") ? 0.3 : 1;
    for (const u of living(w)) {
      if (u === v || u.sick || newly.some((n) => n.v === u)) continue;
      let p = 0, via = "";
      if (u.isle === v.isle) {
        const d = Math.hypot(u.x - v.x, u.y - v.y);
        if (d < 2.4) { p = S.spread * 0.45 * Math.exp(-d / 0.9); via = "along the island paths"; }
      }
      for (const r of w.routes) {
        if ((r.a === v.id && r.b === u.id) || (r.b === v.id && r.a === u.id)) {
          const q = S.spread * r.strength * 0.55;
          if (q > p) { p = q; via = r.kind === "marriage" ? "by a wedding canoe" : r.kind === "trade" ? "by a trade canoe" : "by a kin boat"; }
        }
      }
      p *= qSrc * (has(w.tribes[u.tribe], "quarantine") ? 0.5 : 1) * (1 - u.immune);
      if (p > 0 && rng.chance(p)) newly.push({ v: u, src: v, strain: s.strain, via });
    }
    s.t++;
    if (s.t >= S.duration) {
      if (popOf(v) < s.startPop * 0.08) {
        kill(v, popOf(v), rng);
        v.lost = true; v.lostReason = "plague"; v.sick = null;
        chron(w, "plague", `${v.name} is gone. No one is left to bury the dead.`, v.x, v.y);
        remember(t, `Y${Math.floor(w.tick / 4)}: ${v.name} died of ${S.name}`);
      } else {
        const dead = s.startPop - popOf(v);
        v.sick = null; v.immune = 0.9; t.drivers.plagueSurvived += 1;
        chron(w, "plague", `${v.name} survives ${S.name}. ${dead} dead; the living are immune.`, v.x, v.y);
      }
    }
  }
  for (const c of w.contacts) {
    const a = villageById(w, c.a), b = villageById(w, c.b);
    if (!a || !b || a.lost || b.lost) continue;
    if (a.sick && !b.sick && rng.chance(STRAINS[a.sick.strain].spread * (1 - b.immune))) newly.push({ v: b, src: a, strain: a.sick.strain, via: "with " + c.via });
    else if (b.sick && !a.sick && rng.chance(STRAINS[b.sick.strain].spread * (1 - a.immune))) newly.push({ v: a, src: b, strain: b.sick.strain, via: "with " + c.via });
  }
  for (const n of newly) if (!n.v.sick) infect(w, n.v, n.src, n.strain, n.via);
  for (const v of w.villages) v.immune *= 0.985;
  return w;
}
