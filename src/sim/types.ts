import type { IsleId } from "./terrain";

export type Job = "gatherer" | "farmer" | "fisher" | "builder" | "leader" | "doctor" | "priest" | "warrior" | "boatwright" | "woodcutter" | "quarrier" | "miner" | "smith" | "worker";
export const JOBS: Job[] = ["gatherer", "farmer", "fisher", "builder", "leader", "doctor", "priest", "warrior", "boatwright", "woodcutter", "quarrier", "miner", "smith", "worker"];
export type Res = "wood" | "stone" | "clay" | "brick" | "fiber" | "salt" | "herbs" | "flint" | "copper" | "tin" | "bronze" | "iron" | "spice" | "coal" | "steel";
export const RES: Res[] = ["wood", "stone", "clay", "brick", "fiber", "salt", "herbs", "flint", "copper", "tin", "bronze", "iron", "spice", "coal", "steel"];
export type RegimeType = "elders" | "chief" | "council" | "priestking" | "warlord";
export type FactionId = "farmers" | "seafarers" | "warriors" | "priests" | "crafters";
export const FACTIONS: FactionId[] = ["farmers", "seafarers", "warriors", "priests", "crafters"];
export type Policy = "growth" | "defense" | "sea" | "faith" | "craft";
export interface Faction { id: FactionId; support: number; militancy: number; head: number | null; }
export interface Gov { type: RegimeType; ruler: number | null; rulerFaction: FactionId | null; legitimacy: number; unrest: number; since: number; policy: Policy; uprisings: number; }
export interface Objective { kind: "feed" | "defend" | "secure" | "unite" | "reach" | "grow" | "ally"; text: string; village: number | null; res?: Res; tribe?: number; }
export type Stage = "band" | "camp" | "village" | "town" | "city";
export const STAGES: Stage[] = ["band", "camp", "village", "town", "city"];
export type PowerId = "calm" | "rain" | "wind" | "omen" | "bless" | "drought" | "revolt" | "storm" | "quake" | "plague" | "eruption";
export type StrainId = "fever" | "cough" | "grey";
export type BeliefKey = "awe" | "fear" | "love";

export interface Action { tick: number; power: PowerId; x: number; y: number; strain?: StrainId; }

export interface Sickness { strain: StrainId; t: number; startPop: number; from: number | null; }

/** A settlement: the crowd, stored only as numbers. */
export interface Village {
  id: number; name: string; tribe: number; isle: IsleId;
  x: number; y: number; px: number; py: number; coastal: boolean; fert: number; founded: number;
  /** People by age in years (index 0..79), men and women. men/women/elders are derived counts. */
  m: number[]; f: number[]; men: number; women: number; elders: number;
  food: number; jobs: Record<Job, number>; stage: Stage;
  kin: number; blood: Record<string, number>;
  houses: number; granary: number; defense: number;
  morale: number; hungry: number; threat: number;
  sick: Sickness | null; immune: number;
  mods: { farm: number; fish: number; gather: number };
  lost: boolean; lostReason?: string; peak: number;
  stock: Record<Res, number>; monument: number;
  /** Coal smoke hanging over the village, 0 (clean) to 1 (choking). */
  smog: number;
}

export interface Tribe {
  id: number; name: string; home: IsleId; parent: number | null; alive: boolean;
  tail: string; tip: string; line: string; skin: string; cloth: string; top: string; sash: string; hair: string;
  traits: { bold: number; curious: number; wary: number; patient: number };
  syllables: string[];
  techs: string[]; progress: Record<string, number>;
  belief: Record<BeliefKey, number>;
  known: IsleId[];
  drivers: { raftLoss: number; capsize: number; windSeasons: number; calmSeasons: number; plagueSurvived: number; raids: number; hunger: number; omenVoyage: number; farReturn: number };
  memory: string[];
  age: number; gov: Gov; factions: Faction[]; objective: Objective;
}

export interface Relation {
  a: number; b: number; met: boolean; metTick: number; attitude: number; grudge: number;
  war: boolean; warTicks: number; losses: number; alliance: boolean; marriages: number; trades: number; speaker: boolean;
  /** Overlord tribe id when one tribe pays tribute to the other. */
  overlord: number | null;
}

export interface Route { id: number; a: number; b: number; kind: "trade" | "marriage" | "kin"; strength: number; tier: number; }

export interface Voyage {
  id: number; tribe: number; from: number; fx: number; fy: number; tx: number; ty: number;
  target: IsleId; targetVillage: number | null; purpose: "explore" | "trade" | "marriage" | "colony" | "drift" | "raid";
  crew: number; tier: number; dist: number; progress: number; leg: "out" | "back"; found: boolean; captain: number | null;
  sick: StrainId | null; settlers: number; doomed?: boolean;
}

export interface Agent {
  id: number; name: string; sex: "m" | "f"; born: number; role: string; village: number; tribe: number;
  alive: boolean; died: number | null; goal: string; memory: string[]; founder: boolean; ambition: number;
}

export interface Effect { id: number; power: PowerId; x: number; y: number; r: number; ticks: number; age: number; }

export type ChronKind = "birth" | "death" | "tech" | "war" | "plague" | "voyage" | "power" | "omen" | "contact" | "village" | "end" | "misc" | "politics" | "age" | "climate";
export interface ChronEntry { tick: number; text: string; kind: ChronKind; x?: number; y?: number; }

export interface Fx { kind: "lightning" | "quake" | "eruption" | "omen" | "plague" | "battle" | "lost" | "found" | "uprising" | "age"; x: number; y: number; tick: number; }

export interface Ending { id: "silence" | "farshore" | "unity" | "longage"; tick: number; title: string; text: string; }

export interface World {
  seed: number; tick: number; rngState: number; nextId: number;
  tribes: Tribe[]; villages: Village[]; relations: Relation[]; routes: Route[];
  voyages: Voyage[]; agents: Agent[]; effects: Effect[];
  climate: Record<IsleId, { base: number; rain: number; storm: boolean; calm: boolean; wind: number }>;
  energy: number; faith: number;
  horizon: boolean;
  /** Carbon dioxide in the air, in ppm (280 before industry), and the warming it causes, in degrees C. */
  co2: number; warming: number;
  deposits: Record<IsleId, Record<Res, number>>; depositBase: Record<IsleId, Record<Res, number>>;
  chronicle: ChronEntry[]; events: ChronEntry[]; fx: Fx[];
  contacts: { a: number; b: number; via: string }[];
  endings: Ending[];
}

export const yearOf = (tick: number) => Math.floor(tick / 4);
export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
export const seasonOf = (tick: number) => SEASONS[tick % 4];
