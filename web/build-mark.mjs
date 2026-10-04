// Writes CPIN Explorer's static mark: assets/cpin-explorer/mark.svg and favicon.svg.
// The mark is the globe in miniature at its opening view, the very dots the header draws live
// (prototypes/shared/mini-globe.js), so the picture a page starts with and the one the script draws
// are the same. Run after `npm run vendor` if COBE changes: cd web && npm run mark
import { writeFileSync } from "node:fs";
import { HOME, markShapes, viewOf } from "../prototypes/shared/mini-globe.js";

const out = (name) => new URL(`../assets/cpin-explorer/${name}`, import.meta.url).pathname;
const f = (n) => +n.toFixed(2);
const { ring, dots } = markShapes({ size: 64, view: viewOf(HOME) });
const body = `<circle cx="${f(ring.x)}" cy="${f(ring.y)}" r="${f(ring.r)}" fill="none" stroke="currentColor" stroke-width="${f(ring.width)}" opacity="${ring.alpha}"/>`
  + dots.map((d) => `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r)}" opacity="${f(d.alpha)}"/>`).join("");

// A <symbol> drawn in currentColor, so a page colours it with CSS: <svg><use href=".../mark.svg#mark"/></svg>
writeFileSync(out("mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><symbol id="mark" viewBox="0 0 64 64"><g fill="currentColor">${body}</g></symbol><use href="#mark"/></svg>\n`);
// The same in the site's blue, lighter in dark mode.
writeFileSync(out("favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<style>g{fill:#2a3cf5;color:#2a3cf5}@media (prefers-color-scheme: dark){g{fill:#8b96ff;color:#8b96ff}}</style>
<g>${body}</g></svg>\n`);
console.log(`wrote mark.svg and favicon.svg (${dots.length} dots)`);
