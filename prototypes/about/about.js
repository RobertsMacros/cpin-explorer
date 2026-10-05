import { fetchJson } from "../shared/fetch-json.js";
import { parseBody } from "../shared/note-source.js";
const box = document.getElementById("aboutText");
try {
  const source = await fetchJson("../data/about.json");
  const { fragment } = parseBody(source.details.body);
  box.replaceChildren(fragment);
} catch (error) {
  box.textContent = "The stored text could not be loaded. Use the GOV.UK link above.";
  console.error(error);
} finally {
  box.removeAttribute("aria-busy");
}
const button = document.getElementById("theme");
const modes = ["auto", "light", "dark"];
button.textContent = (document.documentElement.dataset.theme || "auto").toUpperCase();
button.addEventListener("click", () => {
  const next = modes[(modes.indexOf(document.documentElement.dataset.theme || "auto") + 1) % modes.length];
  if (next === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  button.textContent = next.toUpperCase();
  try { localStorage.setItem("cpin-theme", next); } catch {}
});
