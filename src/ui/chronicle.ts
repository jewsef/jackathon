import type { ChronEntry, ChronKind } from "../sim/types";
import { yearOf, seasonOf } from "../sim/types";

const GROUPS: Record<string, ChronKind[]> = {
  people: ["birth", "death", "village"],
  voyage: ["voyage", "contact"],
  war: ["war"],
  plague: ["plague"],
  tech: ["tech"],
  power: ["power", "omen"]
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** The chronicle: every event, in the civilization's history, newest first. */
export class Chronicle {
  entries: ChronEntry[] = [];
  filter = "all";
  onGo: (x: number, y: number) => void = () => {};
  constructor(private list: HTMLElement, private full: HTMLElement) {
    for (const el of [list, full]) el.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li[data-x]") as HTMLElement | null;
      if (li) this.onGo(+li.dataset.x!, +li.dataset.y!);
    });
  }
  reset(all: ChronEntry[]) { this.entries = all.slice(); this.render(); }
  add(e: ChronEntry[]) { if (!e.length) return; this.entries.push(...e); if (this.entries.length > 2000) this.entries.splice(0, this.entries.length - 2000); this.render(); }
  setFilter(f: string) { this.filter = f; this.render(); }
  private visible(): ChronEntry[] {
    const g = GROUPS[this.filter];
    return this.entries.filter((e) => !g || g.includes(e.kind) || e.kind === "end");
  }
  private li(e: ChronEntry) {
    const go = e.x !== undefined && e.y !== undefined;
    return `<li class="k-${e.kind}${go ? " go" : ""}"${go ? ` data-x="${e.x}" data-y="${e.y}"` : ""}><span class="when">Y${yearOf(e.tick)} ${seasonOf(e.tick)}</span><span>${esc(e.text)}</span></li>`;
  }
  render() {
    const v = this.visible();
    this.list.innerHTML = v.slice(-40).reverse().map((e) => this.li(e)).join("");
  }
  renderFull() { this.full.innerHTML = this.visible().slice().reverse().map((e) => this.li(e)).join(""); }
}
