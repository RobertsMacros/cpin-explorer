// The hovered or selected country lit up in its flag's colours: a grid of dots across the country,
// each coloured from the matching point of the flag, plus a fine outline. Drawn on a canvas laid
// over the COBE globe (COBE itself only draws land as uniform dots, with no borders).
import { project } from "../shared/globe-math.js";

const FLAG_COLS = 48, FLAG_ROWS = 36;

export function createCountryGlow({ canvas, shapes, codeOf, sampleFlag, geoContains, geoBounds, isDark }) {
  const ctx = canvas.getContext("2d");
  const cache = new Map();                 // slug -> Promise<{dots, rings, spacing}>
  let current = null, currentData = null, alpha = 0, target = 0, dirty = true;

  async function build(slug) {
    const features = shapes.get(slug);
    if (!features?.length) return null;
    // Each landmass separately, spaced for its own size: mainland France gets a fine grid even though
    // France's shape also spans French Guiana and Réunion.
    const polygons = features.flatMap((f) => (f.geometry.type === "MultiPolygon"
      ? f.geometry.coordinates.map((c) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: c } }))
      : [f]));
    const [[W, S], [E, N]] = geoBounds({ type: "FeatureCollection", features });
    const fullWidth = W > E ? E + 360 - W : E - W;
    const flag = await sampleFlag(codeOf(slug), FLAG_COLS, FLAG_ROWS).catch(() => null);
    const dots = [];
    let spacingUsed = 1.6, rows = 0;
    for (const poly of polygons) {
      const [[w, s], [e, n]] = geoBounds(poly);
      const width = w > e ? e + 360 - w : e - w, height = n - s;
      const spacing = Math.max(0.22, Math.min(1.6, Math.max(width, height) / 30));
      spacingUsed = Math.min(spacingUsed, spacing);
      if (width < spacing && height < spacing) continue;                  // specks: the outline shows them
      for (let lat = s + spacing / 2; lat < n; lat += spacing) {
        const lonStep = spacing / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
        for (let x = lonStep / 2; x < width; x += lonStep) {
          let lon = w + x;
          if (lon > 180) lon -= 360;
          if (!geoContains(poly, [lon, lat])) continue;
          // Colour from the flag, mapped over the whole country's extent.
          let gx = lon - W; if (gx < 0) gx += 360;
          const u = Math.min(FLAG_COLS - 1, Math.max(0, Math.floor((gx / fullWidth) * FLAG_COLS)));
          const v = Math.min(FLAG_ROWS - 1, Math.max(0, Math.floor(((N - lat) / (N - S)) * FLAG_ROWS)));
          dots.push({ lat, lon, rgb: flag?.[v * FLAG_COLS + u] ?? null, spacing });
        }
        if (++rows % 6 === 0) await new Promise((r) => setTimeout(r));   // big countries: stay responsive
      }
    }
    const rings = features.flatMap((f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates
      : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flat() : []));
    return { dots, rings, spacing: spacingUsed };
  }

  function colour(rgb) {
    if (!rgb) return isDark() ? "rgb(120 130 150)" : "rgb(150 160 175)";
    const l = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    if (!isDark() && l > 0.9) return "rgb(214 219 227)";          // white stripes still read on white
    if (isDark() && l < 0.08) return "rgb(70 76 92)";
    return `rgb(${rgb[0] | 0} ${rgb[1] | 0} ${rgb[2] | 0})`;
  }

  return {
    /** Show this country (or none). The glow fades in once its dots are ready. */
    set(slug) {
      if (slug === current) return;
      current = slug;
      target = slug ? 1 : 0;
      dirty = true;
      if (!slug) return;
      if (!cache.has(slug)) cache.set(slug, build(slug));
      cache.get(slug).then((data) => {
        canvas.dataset.dots = data?.dots.length ?? 0;               // visible to automated checks
        if (current === slug) { currentData = data; dirty = true; }
      }).catch((e) => { canvas.dataset.error = String(e?.message || e); });
    },
    get active() { return alpha > 0.01 || target > 0; },
    /** Redraw for the current view; returns true while still animating. */
    draw(view, cssSize, dpr, viewChanged) {
      const fading = Math.abs(target - alpha) > 0.01;
      if (!viewChanged && !fading && !dirty) return false;
      alpha += (target - alpha) * 0.22;
      if (!fading) alpha = target;
      dirty = false;
      if (canvas.width !== Math.round(cssSize * dpr)) { canvas.width = canvas.height = Math.round(cssSize * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssSize, cssSize);
      if (!currentData || alpha < 0.01) return fading;
      const { dots, rings } = currentData;
      const radiusPx = 0.8 * (cssSize / 2) * (view.scale || 1);              // globe radius on screen
      for (const d of dots) {
        const r = Math.max(0.9, ((d.spacing * Math.PI) / 180) * radiusPx * 0.36);
        const p = project([d.lat, d.lon], view);
        if (p.depth <= 0.02) continue;
        ctx.globalAlpha = alpha * Math.min(1, p.depth * 4);
        ctx.fillStyle = colour(d.rgb);
        ctx.beginPath();
        ctx.arc(p.x * cssSize, p.y * cssSize, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--blue") || "#2a3cf5";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const ring of rings) {
        let prev = null;
        for (const [lon, lat] of ring) {
          const p = project([lat, lon], view);
          if (prev && p.depth > 0 && prev.depth > 0) {
            ctx.moveTo(prev.x * cssSize, prev.y * cssSize);
            ctx.lineTo(p.x * cssSize, p.y * cssSize);
          }
          prev = p;
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      return fading;
    },
    refresh() { dirty = true; },
  };
}
