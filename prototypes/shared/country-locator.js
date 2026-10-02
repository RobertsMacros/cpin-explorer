// Which country (of those with notes) is at a given latitude/longitude?
//
// Uses Natural Earth shapes keyed by ISO numeric code, plus two corrections from
// config/countries.json (exported into data.json):
//   feature_aliases   whole shapes that belong to a listed country (Somaliland -> Somalia)
//   boundary_patches  small areas drawn as another country in the 1:50m data, checked first
//                     (Crimea -> Ukraine, Gaza -> Palestine, Golan Heights -> Syria)
import { inRing } from "./globe-math.js";

export function makeCountryLocator({ topo, data, feature, geoBounds, geoContains }) {
  const isoToSlug = new Map(data.countries.map((c) => [c.iso_n3, c.slug]));
  const shapes = feature(topo, topo.objects.countries).features.flatMap((f) => {
    const slug = data.feature_aliases?.[f.properties.name]?.slug ?? isoToSlug.get(f.id);
    return slug ? [{ slug, f, bounds: geoBounds(f) }] : [];
  });
  const inBounds = ([lon, lat], [[w, s], [e, n]]) =>
    lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);
  const patches = data.boundary_patches ?? [];

  return function countryAt([lat, lon]) {
    for (const patch of patches) if (inRing([lon, lat], patch.ring)) return patch.slug;
    for (const s of shapes) if (inBounds([lon, lat], s.bounds) && geoContains(s.f, [lon, lat])) return s.slug;
    return null;
  };
}
