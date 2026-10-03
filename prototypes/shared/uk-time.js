// One clock for the whole site: UK time (Europe/London), labelled BST or GMT. The scraper records
// UTC; readers are in the UK, and mixing "16:11 UTC" with a local "08:24" made two times that were
// an hour apart look unrelated.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "numeric", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
});

function parts(when) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: p.day, month: MONTHS[Number(p.month) - 1], year: p.year, time: `${p.hour}:${p.minute}`, zone: p.timeZoneName === "GMT+1" ? "BST" : p.timeZoneName };
}

/** The UK calendar date as numbers: { day, month (0-11), year }, or null for a bad value. */
export function ukParts(when) {
  const p = parts(when);
  return p ? { day: Number(p.day), month: MONTHS.indexOf(p.month), year: Number(p.year) } : null;
}

/** "03 OCT 2026 · 08:24 BST" */
export function ukDateTime(when) {
  const p = parts(when);
  return p ? `${p.day} ${p.month} ${p.year} · ${p.time} ${p.zone}` : "—";
}

/** "08:24 BST" */
export function ukTime(when) {
  const p = parts(when);
  return p ? `${p.time} ${p.zone}` : "—";
}

/** "03 OCT 2026" (the UK calendar day, which can differ from the UTC day around midnight) */
export function ukDate(when) {
  const p = parts(when);
  return p ? `${p.day} ${p.month} ${p.year}` : "—";
}
