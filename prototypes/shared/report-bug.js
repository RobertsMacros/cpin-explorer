// "Report a bug" in the footer: opens an email to the site's owner with the page address and
// browser filled in, so a report says where the problem was. Nothing is sent by the page itself.
import { BUG_REPORT } from "./site-config.js";

export function bugMailto(config, { href, title, agent, size }) {
  if (!config?.user || !config?.domain) return null;
  const body = [
    "What happened:", "", "",
    "What I expected:", "", "",
    "— Details (please leave in) —",
    `Page: ${href}`,
    `Title: ${title}`,
    `Browser: ${agent}`,
    `Window: ${size}`,
  ].join("\r\n");                                  // RFC 6068: line breaks in a mailto body are CRLF
  return `mailto:${config.user}@${config.domain}?subject=${encodeURIComponent("CPIN Explorer bug")}&body=${encodeURIComponent(body)}`;
}

if (typeof document !== "undefined") {
  for (const link of document.querySelectorAll("[data-report-bug]")) {
    const fresh = () => bugMailto(BUG_REPORT, { href: location.href, title: document.title, agent: navigator.userAgent, size: `${innerWidth}×${innerHeight}` });
    if (!fresh()) { link.hidden = true; continue; }
    link.hidden = false;
    link.href = fresh();
    // The page address changes as you move around (country, edition, search): refresh it on use.
    for (const ev of ["pointerdown", "focus", "keydown"]) link.addEventListener(ev, () => { link.href = fresh(); });
  }
}
