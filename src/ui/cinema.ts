import type { ChronEntry, Fx, World } from "../sim/types";
import { yearOf } from "../sim/types";
import { WX, WY, HOME } from "../sim/terrain";
import type { MapView3D } from "../render3d/view";
import { orbitShot, flyoutShot, titleCard, PHOTO_FILTERS } from "../render/cinema";
import { visibleWorld } from "../render/common";

type Snap = Omit<World, "chronicle">;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

interface Deps {
  map: MapView3D;
  send: (m: { type: "timelapse"; seconds?: number } | { type: "tl-stop" }) => void;
  getSpeed: () => number;
  setSpeed: (v: number) => void;
  store: { get(k: string): string | null; set(k: string, v: string): boolean };
  toast: (s: string) => void;
  onLive: () => void;
}

/**
 * Cinematics: age-dawn flyovers with title cards, a photo mode, and a time-lapse of the whole
 * history. Only for the 3D view.
 */
export class Cinema {
  timelapse = false;
  photo = false;
  private on: boolean;
  private lastShot = -Infinity;
  private resumeSpeed: number | null = null;
  private filter = "none";
  private captionUntil = 0;
  constructor(private d: Deps) {
    this.on = d.store.get("bc.cine") !== "off";
    const btn = $("btn-cine");
    const sync = () => { btn.textContent = this.on ? "Cinematics: on" : "Cinematics: off"; btn.setAttribute("aria-pressed", String(this.on)); };
    sync();
    btn.addEventListener("click", () => { this.on = !this.on; d.store.set("bc.cine", this.on ? "on" : "off"); sync(); });
    $("btn-timelapse").addEventListener("click", () => this.startTimeLapse());
    $("btn-tlstop").addEventListener("click", () => d.send({ type: "tl-stop" }));
    $("btn-photo").addEventListener("click", () => (this.photo ? this.exitPhoto() : this.enterPhoto()));
    $("btn-photoexit").addEventListener("click", () => this.exitPhoto());
    $("ph-labels").addEventListener("change", (e) => d.map.setLabels((e.target as HTMLInputElement).checked));
    $("ph-filter").addEventListener("change", (e) => { this.filter = PHOTO_FILTERS[(e.target as HTMLSelectElement).value] ?? "none"; $("map").style.filter = this.filter; });
    $("ph-time").addEventListener("input", (e) => d.map.setTimeOfDay(+(e.target as HTMLInputElement).value / 100));
    $("btn-snap").addEventListener("click", () => this.snap());
    $("btn-photoclose").addEventListener("click", () => ($("photoprev").hidden = true));
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape" && this.photo) this.exitPhoto();
      if (e.key.toLowerCase() === "p" && !e.ctrlKey && !e.metaKey) this.photo ? this.exitPhoto() : this.enterPhoto();
    });
  }

  // ---------- age-dawn flyovers ----------
  /** New chronicle entries: a new age or the world growing gets a flyover and a title card. */
  onEntries(entries: ChronEntry[]) {
    if (!this.on || this.timelapse || this.photo || this.d.map.playing() || performance.now() - this.lastShot < 25000) return;
    for (const e of entries) {
      if (e.kind !== "age" || e.x === undefined || e.y === undefined) continue;
      const card = titleCard(e.text);
      if (!card) continue;
      this.lastShot = performance.now();
      const grows = card.title === "The world grows";
      this.resumeSpeed = this.d.getSpeed();
      this.d.setSpeed(0);
      this.letterbox(card.title, card.sub);
      this.d.map.playShot(grows ? flyoutShot(e.x, e.y, WX, WY) : orbitShot(e.x, e.y, this.d.map.yaw), grows ? 9 : 8, () => {
        this.letterbox(null);
        if (this.resumeSpeed !== null) { this.d.setSpeed(this.resumeSpeed || 1); this.resumeSpeed = null; }
      });
      return;
    }
  }
  private letterbox(title: string | null, sub = "") {
    const el = $("cine");
    if (!title) { el.classList.remove("show"); setTimeout(() => { if (!el.classList.contains("show")) el.hidden = true; }, 700); return; }
    $("cine-title").textContent = title; $("cine-sub").textContent = sub;
    el.hidden = false; void el.offsetWidth; el.classList.add("show");
  }

  // ---------- time-lapse ----------
  startTimeLapse() {
    if (this.timelapse) return;
    if (this.photo) this.exitPhoto();
    this.timelapse = true;
    document.body.classList.add("timelapse");
    $("tlbar").hidden = false; $("tl-cap").textContent = "";
    // history starts in the home waters; the view widens by itself when the replay reaches the ocean ships
    this.d.map.flyTo(HOME.w / 2, HOME.h / 2, 1);
    this.d.map.autoOrbit = true;
    this.d.send({ type: "timelapse", seconds: 45 });
  }
  /** One replayed frame: show the world as it was, with the year and the big events of the moment. */
  onFrame(world: Snap, entries: ChronEntry[], fx: Fx[], progress: number) {
    this.d.map.setWorld(visibleWorld(world), fx);
    $("tl-year").textContent = `Year ${yearOf(world.tick)}`;
    ($("tl-prog") as HTMLElement).style.width = Math.round(progress * 100) + "%";
    const now = performance.now();
    const pick = entries.find((e) => e.kind === "age" || e.kind === "end") ?? (now > this.captionUntil ? entries.find((e) => e.kind === "contact" || e.kind === "climate") : undefined);
    if (pick && (!world.horizon ? (pick.x === undefined || (pick.x < 16.8 && (pick.y ?? 0) < 9.8)) : true)) { $("tl-cap").textContent = pick.text; this.captionUntil = now + 3500; }
  }
  onEnd() {
    this.timelapse = false;
    document.body.classList.remove("timelapse");
    $("tlbar").hidden = true;
    this.d.map.autoOrbit = false;
    this.d.toast("Back to the present.");
    this.d.onLive();
  }

  // ---------- photo mode ----------
  enterPhoto() {
    if (this.timelapse) return;
    this.photo = true;
    document.body.classList.add("photo");
    $("photobar").hidden = false;
    this.d.map.setLabels(($("ph-labels") as HTMLInputElement).checked);
    $("map").style.filter = this.filter;
  }
  exitPhoto() {
    if (!this.photo) return;
    this.photo = false;
    document.body.classList.remove("photo");
    $("photobar").hidden = true;
    this.d.map.setLabels(true);
    this.d.map.setTimeOfDay(null);
    $("map").style.filter = "none";
  }
  private snap() {
    const url = this.d.map.capture(this.filter);
    ($("photo-img") as HTMLImageElement).src = url;
    ($("photo-dl") as HTMLAnchorElement).href = url;
    $("photoprev").hidden = false;
  }
}
