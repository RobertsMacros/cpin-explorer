// Owner-selected silhouette, redrawn as a vector from the tab reference (6 Oct 2026).
// The same path supplies the header, theme-aware favicon and Word export artwork.
import { writeFileSync } from "node:fs";

const out = (name) => new URL(`../assets/cpin-explorer/${name}`, import.meta.url).pathname;
// A compact rounded silhouette: broad top, short right point and tapered lower lobe.
const silhouette = "M15 8 C18 6 22 8 27 10 L37 12 C42 14 48 16 53 19 C56 21 55 24 52 26 L37 33 L32 48 C31 53 28 57 24 57 C20 56 17 52 16 47 L13 33 C11 29 8 24 8 20 C8 16 12 12 15 8 Z";
const body = `<path d="${silhouette}"/>`;
writeFileSync(out("mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><symbol id="mark" viewBox="0 0 64 64"><g fill="currentColor">${body}</g></symbol><use href="#mark"/></svg>\n`);
writeFileSync(out("favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>path{fill:#181a20}@media(prefers-color-scheme:dark){path{fill:#fff}}</style>${body}</svg>\n`);
console.log("wrote silhouette mark.svg and favicon.svg");
