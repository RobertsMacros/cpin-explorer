// Real places against the real borders and the real exported data (prototypes/dashboard/data.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { geoBounds, geoContains } from "d3-geo";
import { feature } from "topojson-client";
import { makeCountryLocator } from "../../prototypes/shared/country-locator.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = read("../../prototypes/dashboard/data.json");
const topo = read("../../prototypes/vendor/countries-gbr.json");
const countryAt = makeCountryLocator({ topo, data, feature, geoBounds, geoContains });

const cases = {
  // Places the standard (de facto) borders get wrong for a UK tool; the UK point of view handles
  // the first, second and fourth itself, and config/countries.json patches the Golan.
  "Simferopol, Crimea": [[44.95, 34.1], "ukraine"],
  "Gaza City": [[31.5, 34.47], "palestine"],
  "Golan Heights": [[33.05, 35.8], "syria"],
  "Hargeisa, Somaliland": [[9.56, 44.06], "somalia"],
  // Ordinary cases and neighbours.
  "Kyiv": [[50.45, 30.52], "ukraine"],
  "Moscow": [[55.75, 37.62], "russia"],
  "Ussuriysk, Russian Far East": [[43.8, 131.95], "russia"],
  "Chukotka, east of 180°": [[66, -175], "russia"],
  "Ramallah": [[31.9, 35.2], "palestine"],
  "Damascus": [[33.51, 36.29], "syria"],
  "Mogadishu": [[2.05, 45.32], "somalia"],
  "Paris": [[48.86, 2.35], "france"],
  "Kinshasa": [[-4.32, 15.31], "democratic-republic-of-the-congo"],
  "Brazzaville (Republic of the Congo, no notes)": [[-4.26, 15.24], null],
  // Coastal capitals of small states can fall just offshore at 1:50m, so test inland towns;
  // in the page, each country's pin is the click target for these.
  "Farafenni, Gambia": [[13.57, -15.6], "gambia"],
  "Port of Spain": [[10.66, -61.51], "trinidad-and-tobago"],
  "Mandeville, Jamaica": [[18.04, -77.5], "jamaica"],
  "Kuwait City": [[29.37, 47.98], "kuwait"],
  "Zahle, Lebanon": [[33.85, 35.9], "lebanon"],
  "Yangon": [[16.84, 96.17], "burma"],
  "Tel Aviv (no notes)": [[32.08, 34.78], null],
  "Madrid (no notes)": [[40.42, -3.7], null],
  "Mid-Atlantic": [[20, -40], null],
};

test("every country in the current collection has a marker and a map shape", () => {
  for (const c of data.countries.filter((c) => !c.dropped_from_collection)) {
    assert.ok(c.iso_n3 && c.marker, `${c.slug} has no map entry`);
    assert.equal(countryAt(c.marker), c.slug, `${c.slug}'s marker is not inside its own shape`);
  }
});

for (const [place, [latLon, expected]] of Object.entries(cases)) {
  test(`${place} -> ${expected}`, () => assert.equal(countryAt(latLon), expected));
}
