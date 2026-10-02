// Copies third-party code, map data and fonts into prototypes/vendor/ so pages never load from a CDN.
// Run: cd web && npm install && npm run vendor
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const out = new URL("../prototypes/vendor/", import.meta.url).pathname;
mkdirSync(join(out, "fonts"), { recursive: true });

// 1. One ES module with everything the globe needs.
await build({
  stdin: {
    contents: `
      export { default as createGlobe } from "cobe";
      export { geoBounds, geoContains, geoDistance, geoInterpolate } from "d3-geo";
      export { feature, merge } from "topojson-client";
    `,
    resolveDir: new URL(".", import.meta.url).pathname,
    loader: "js",
  },
  bundle: true,
  format: "esm",
  minify: true,
  outfile: join(out, "globe-deps.js"),
  legalComments: "inline",
});

// 2. Country borders are built separately by build-borders.mjs (Natural Earth, UK point of view).

// 3. Fonts (Geist family, SIL Open Font License). Read by path: geist's exports map hides package.json.
const modules = new URL("./node_modules/", import.meta.url).pathname;
const geist = join(modules, "geist");
const fonts = {
  "Geist-Variable.woff2": "dist/fonts/geist-sans/Geist-Variable.woff2",
  "GeistMono-Variable.woff2": "dist/fonts/geist-mono/GeistMono-Variable.woff2",
  "GeistPixel-Square.woff2": "dist/fonts/geist-pixel/GeistPixel-Square.woff2",
  "GeistPixel-Line.woff2": "dist/fonts/geist-pixel/GeistPixel-Line.woff2",
};
for (const [name, path] of Object.entries(fonts)) copyFileSync(join(geist, path), join(out, "fonts", name));
copyFileSync(join(geist, "LICENSE.txt"), join(out, "fonts", "GEIST-LICENSE.txt"));

// 4. Flags for the countries with notes (flag-icons, MIT), drawn as dot matrices by dot-flag.js.
//    One JSON file of SVG sources rather than 47 requests.
mkdirSync(join(out, "flags"), { recursive: true });
const countries = JSON.parse(readFileSync(new URL("../config/countries.json", import.meta.url), "utf8")).countries;
const flags = Object.fromEntries(Object.values(countries).map(({ iso_a2 }) =>
  [iso_a2, readFileSync(join(modules, "flag-icons", "flags", "4x3", `${iso_a2}.svg`), "utf8")]));
writeFileSync(join(out, "flags", "flags.json"), JSON.stringify(flags));
copyFileSync(join(modules, "flag-icons", "LICENSE"), join(out, "flags", "FLAG-ICONS-LICENSE.txt"));

const versions = Object.fromEntries(
  ["cobe", "d3-geo", "topojson-client", "geist", "flag-icons"].map((p) => [
    p, JSON.parse(readFileSync(join(modules, p, "package.json"), "utf8")).version,
  ]),
);
writeFileSync(join(out, "VERSIONS.json"), JSON.stringify(versions, null, 2) + "\n");
console.log("vendored into", out, versions);
