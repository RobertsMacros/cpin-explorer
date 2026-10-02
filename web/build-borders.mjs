// Builds prototypes/vendor/countries-gbr.json: the 47 countries with notes, from Natural Earth's
// 1:10m admin-0 countries, UK point of view (public domain), simplified to a small TopoJSON.
// The UK view puts Crimea in Ukraine, Gaza in Palestine and Somaliland in Somalia.
// Source revision: .cache/gbr-source.txt (download it with the curl command in README.md).
import { readFileSync, writeFileSync } from "node:fs";
import mapshaper from "mapshaper";

const here = (p) => new URL(p, import.meta.url).pathname;
const ids = Object.values(JSON.parse(readFileSync(here("../config/countries.json"), "utf8")).countries).map((c) => c.iso_n3);
const [revision, date] = readFileSync(here(".cache/gbr-source.txt"), "utf8").trim().split(" ");
const out = here("../prototypes/vendor/countries-gbr.json");

await mapshaper.runCommands([
  `-i ${here(".cache/ne_10m_admin_0_countries_gbr.geojson")}`,
  `-each 'id = String(ISO_N3 !== "-99" ? ISO_N3 : ISO_N3_EH).padStart(3, "0")'`,
  `-filter '"${ids.join(",")}".split(",").indexOf(id) > -1'`,
  `-filter-fields id,NAME`,
  `-simplify 6% keep-shapes`,
  `-rename-layers countries`,
  `-o format=topojson quantization=100000 id-field=id ${out} force`,
].join(" "));

const versions = JSON.parse(readFileSync(here("../prototypes/vendor/VERSIONS.json"), "utf8"));
versions["natural-earth ne_10m_admin_0_countries_gbr"] = { revision, date, licence: "public domain" };
writeFileSync(here("../prototypes/vendor/VERSIONS.json"), JSON.stringify(versions, null, 2) + "\n");
console.log("wrote", out);
