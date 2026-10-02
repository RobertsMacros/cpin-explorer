"""Note titles, and grouping notes into series (successive editions of the same report).

GOV.UK titles look like:
  'Country policy and information note: actors of protection, Kenya, July 2026 (accessible)'
  'Country bulletin Iran: Kurds and Kurdish political groups, May 2026 (accessible)'
"""
import re
from dataclasses import dataclass

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
# The publication month usually follows a comma (", July 2026"), but not always ("modern slavery
# October 2024"). A trailing month that closes a range ("December 2025 to January 2026") is topic.
_DATE_RE = re.compile(r"(,\s*|\s*\(|\s+)\b(" + "|".join(MONTHS) + r")\s+(\d{4})\)?\s*$", re.IGNORECASE)
_RANGE_END_RE = re.compile(r"(\bto|[-–])$", re.IGNORECASE)
# 'acces+ible' also matches GOV.UK's own typo '(accesible)' (Vietnam, September 2025).
_ACCESSIBLE_RE = re.compile(r"\s*\(acces+ible(?: version)?\)\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class NoteTitle:
    raw: str
    kind: str                # 'country policy and information note', 'country bulletin', ...
    topic: str               # 'actors of protection'
    country: str | None      # as written in the title, if it names the country
    month: str | None        # '2026-07'
    accessible: bool


# Spellings GOV.UK itself has used in titles or URLs.
_KNOWN_VARIANTS = {"Colombia": ["Columbia"]}


def country_aliases(name: str) -> list[str]:
    """'Myanmar (Burma)' -> ['Myanmar (Burma)', 'Myanmar', 'Burma']."""
    aliases = [name, *_KNOWN_VARIANTS.get(name, [])]
    m = re.match(r"^(.*?)\s*\((.*?)\)\s*$", name)
    if m:
        aliases += [m.group(1), m.group(2)]
    return [a for a in aliases if a]


_SLUG_KINDS = ("country policy and information note", "country information note", "country bulletin",
               "report of a fact finding mission")


def title_from_slug(slug: str) -> str:
    """Rebuild a title for an archived edition whose page gave none, from its URL slug:
    'country-policy-and-information-note-actors-of-protection-columbia-january-2025-accessible'
    -> 'country policy and information note: actors of protection columbia, january 2025'."""
    text = re.sub(r"(-accessible)?(-version)?(--?\d+)?$", "", slug).replace("-", " ")
    for kind in _SLUG_KINDS:
        if text.startswith(kind + " "):
            text = f"{kind}: {text[len(kind) + 1:]}"
            break
    return re.sub(r" (" + "|".join(MONTHS) + r") (\d{4})$", r", \1 \2", text)


def _strip_country(text: str, country: str | None) -> tuple[str, str | None]:
    if not country:
        return text, None
    for alias in sorted(country_aliases(country), key=len, reverse=True):
        if text.lower().endswith(alias.lower()):
            head = text[: -len(alias)]
            if not head or head.endswith((" ", ",")):
                return head.rstrip(" ,"), text[len(head):]
    return text, None


def parse_note_title(title: str, country: str | None = None) -> NoteTitle:
    text = title.strip()
    if text and " " not in text and "-" in text:
        text = title_from_slug(text)
    accessible = bool(_ACCESSIBLE_RE.search(text))
    text = _ACCESSIBLE_RE.sub("", text)
    month = None
    m = _DATE_RE.search(text)
    if m and not m.group(1).strip() and _RANGE_END_RE.search(text[: m.start()].rstrip()):
        m = None
    if m:
        month = f"{m.group(3)}-{MONTHS.index(m.group(2).lower()) + 1:02d}"
        text = text[: m.start()].rstrip(" ,")
    kind, _, rest = text.partition(":") if ":" in text else ("", "", text)
    kind, found_in_kind = _strip_country(kind.strip(), country)
    rest, found_in_rest = _strip_country(rest.strip(), country)
    found_leading = None
    for alias in country_aliases(country) if country else []:
        # 'Country policy and information note: China: non-Christian religious groups'
        if rest.lower().startswith(alias.lower() + ":"):
            found_leading, rest = rest[: len(alias)], rest[len(alias) + 1:]
            break
    return NoteTitle(raw=title, kind=kind.strip().lower(), topic=rest.strip(),
                     country=found_in_rest or found_in_kind or found_leading, month=month, accessible=accessible)


def series_key(note: NoteTitle) -> str:
    """The key that ties successive editions of one report together.

    GOV.UK retires a note's URL when it publishes a new edition ('...-february-2022-accessible'
    becomes '...-august-2025-accessible'), so URLs cannot link editions. Titles can, but they
    drift between editions, for example:
      'sexual orientation and gender identity and expression' vs '... or expression'
      'medical treatment and healthcare' vs 'healthcare and medical treatment'
      'Country policy and information note' vs 'Country information note' for the same topic
    Two notes with the same key are diffed against each other on the timeline; different keys
    are treated as separate reports.
    """
    family = next((name for pattern, name in _FAMILIES if re.search(pattern, note.kind)), "note")
    words = re.findall(r"[a-z0-9]+", note.topic.lower().replace("&", " and "))
    core = sorted({w for w in words if w not in _FILLER})
    key = f"{family}:{'-'.join(core) or 'untitled'}"
    return _RENAMED.get(key, key)


# Reports GOV.UK renamed between editions, where the version numbers show one lineage.
_RENAMED = {
    # China: 'Hong Kong national security law' v3.0 (June 2022) became '... legislation' v4.0 (April 2025).
    "note:hong-kong-legislation-national-security": "note:hong-kong-law-national-security",
}


# Report families. CPINs replaced 'country information and guidance' in 2016 and later absorbed
# 'country information notes', so those are one lineage; bulletins and fact-finding reports are
# separate products that can run alongside a CPIN on the same topic.
_FAMILIES = [(r"bulletin", "bulletin"), (r"fact-finding", "fact-finding")]
# Words that do not identify a report: and/or swaps, articles, and filler that comes and goes
# between editions ('medical and healthcare issues' / 'medical and healthcare provision').
# Word order is ignored too ('medical treatment and healthcare' / 'healthcare and medical treatment').
_FILLER = {"a", "an", "and", "or", "the", "of", "in", "on", "for", "to", "with", "including",
           "issues", "provision", "treatment"}
