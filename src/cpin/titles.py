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
_FFM_RE = re.compile(r"^report of (?:a |the )?(?:home office )?fact[- ]finding mission\b", re.IGNORECASE)
_ACCESSIBLE_RE = re.compile(r"\s*\(acces+ible(?: version)?\)\s*$", re.IGNORECASE)
# A title with a comma where the colon should be, after the kind of document.
_KIND_COMMA_RE = re.compile(r"^(country policy and information note|country information note|country information and guidance"
                            r"(?: report)?|country bulletin),\s*", re.IGNORECASE)


@dataclass(frozen=True)
class NoteTitle:
    raw: str
    kind: str                # 'country policy and information note', 'country bulletin', ...
    topic: str               # 'actors of protection'
    country: str | None      # as written in the title, if it names the country
    month: str | None        # '2026-07'
    accessible: bool


# Spellings GOV.UK itself has used in titles or URLs, and names a country page has gone by: Palestine's page
# was 'Occupied Palestinian Territories' until 2 October 2025, and its older notes say 'OPT' or 'OPTs'.
_KNOWN_VARIANTS = {"Colombia": ["Columbia"],
                   "Palestine": ["Occupied Palestinian Territories", "Occupied Palestinian Territory", "OPTs", "OPT"]}


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
        # 'security and humanitarian situation, OPT (Gaza)': the country, then the part of it in brackets.
        part = re.search(r"[,\s]\s*" + re.escape(alias) + r"\s+(\([^()]*\))$", text, re.IGNORECASE)
        if part:
            return f"{text[: part.start()].rstrip(' ,')} {part.group(1)}", alias
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
    ffm = _FFM_RE.match(text) if ":" not in text else None
    if ffm:
        # 'Report of a Home Office fact-finding mission to Sri Lanka': no colon, and no topic but the mission itself.
        rest, found = _strip_country(re.sub(r"^to\s+", "", text[ffm.end():].strip(" ,")), country)
        return NoteTitle(raw=title, kind="report of a fact-finding mission", topic=rest.strip() or "Home Office fact-finding mission",
                         country=found, month=month, accessible=accessible)
    kind, _, rest = text.partition(":") if ":" in text else ("", "", text)
    comma = _KIND_COMMA_RE.match(text) if ":" not in text else None
    if comma:                                          # 'Country Policy and Information Note, Russia, sexual orientation …'
        kind, rest = comma.group(1), text[comma.end():]
    kind, found_in_kind = _strip_country(kind.strip(), country)
    rest, found_in_rest = _strip_country(rest.strip(), country)
    found_leading = None
    for alias in sorted(country_aliases(country), key=len, reverse=True) if country else []:
        # 'Country policy and information note: China: non-Christian religious groups'; and, in older titles,
        # the country first with a comma or nothing after it: 'Afghanistan, Hindus and Sikhs', 'Iraq ‘honour’ crimes'.
        lead = re.match(re.escape(alias) + r"(?::\s*|,\s*|\s+)(?=\S)", rest, re.IGNORECASE)
        if lead:
            found_leading, rest = rest[: len(alias)], rest[lead.end():]
            break
    if not rest.strip() and "background note" in kind.lower():
        rest = "background note"                       # 'Country background note: Egypt, December 2020' names no topic
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
    # Albania: 'trafficking' v11.0 (September 2022) became 'human trafficking' v14.0 (February 2023).
    # Mapped onto the shorter name, which Vietnam's live report still uses.
    "note:human-trafficking": "note:trafficking",
    # Nigeria: 'sexual orientation and gender identity or expression' v3.0 (February 2022) became
    # 'sexual orientation, gender identity and expression, and sex characteristics' v4.0 (June 2025).
    "note:characteristics-expression-gender-identity-orientation-sex-sexual": "note:expression-gender-identity-orientation-sexual",
    # Palestine: 'security and humanitarian situation, OPT (Gaza)' v2.0 (March 2019) became 'the humanitarian
    # situation in Gaza' v3.0 (July 2022). The security situation got a note of its own, v1.0, in November 2024.
    "note:gaza-humanitarian-security-situation": "note:gaza-humanitarian-situation",
    # Iraq: the live report's title names the country twice ('Iraq Blood feuds, honour crimes and tribal violence,
    # Iraq, July 2024'). Its key was made when the first 'Iraq' still counted as a topic word, and is kept: the
    # key is the report's address on the site, and saved highlights point at it.
    "note:blood-crimes-feuds-honour-tribal-violence": "note:blood-crimes-feuds-honour-iraq-tribal-violence",
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
