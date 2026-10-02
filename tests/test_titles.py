import pytest

from cpin.titles import parse_note_title, series_key


def test_standard_cpin_title():
    t = parse_note_title("Country policy and information note: actors of protection, Kenya, July 2026 (accessible)", "Kenya")
    assert (t.kind, t.topic, t.country, t.month, t.accessible) == (
        "country policy and information note", "actors of protection", "Kenya", "2026-07", True)


def test_country_in_the_kind_and_brackets_in_the_topic():
    t = parse_note_title("Country bulletin Iran: Kurds and Kurdish political groups, May 2026 (accessible)", "Iran")
    assert (t.kind, t.topic, t.country) == ("country bulletin", "Kurds and Kurdish political groups", "Iran")
    t = parse_note_title("Country policy and information note: female genital mutilation (FGM), Kenya, April 2025", "Kenya")
    assert (t.topic, t.accessible) == ("female genital mutilation (FGM)", False)


def test_bracketed_country_names_match_either_part():
    t = parse_note_title("Country policy and information note: military service, Burma, March 2024", "Myanmar (Burma)")
    assert (t.topic, t.country) == ("military service", "Burma")


@pytest.mark.parametrize("title, country, expected", [
    # Real GOV.UK titles that broke the first version of the parser (2 October 2026).
    ("Country policy and information note: opposition to the state, Vietnam, September 2025 (accesible)",
     "Vietnam", ("opposition to the state", "Vietnam", "2025-09", True)),
    ("Country policy and information note: China: non-Christian religious groups, December 2024 (accessible)",
     "China", ("non-Christian religious groups", "China", "2024-12", True)),
    ("Report of a fact-finding mission: Organised criminal groups (OCGs), Brazil (accessible)",
     "Brazil", ("Organised criminal groups (OCGs)", "Brazil", None, True)),
    (" Country policy and information note: non-Arab Darfuris, October 2024 (accessible)",
     "Sudan", ("non-Arab Darfuris", None, "2024-10", True)),
    ("Country policy and information note: Peoples' Democratic Party (HDP), October 2023 (accessible)",
     "Turkey", ("Peoples' Democratic Party (HDP)", None, "2023-10", True)),
    ("Country bulletin Iran: protests of December 2025 to January 2026 (accessible)",
     "Iran", ("protests of December 2025 to January 2026", "Iran", None, True)),
    ("Country policy and information note: China: modern slavery October 2024 (accessible)",
     "China", ("modern slavery", "China", "2024-10", True)),
])
def test_real_titles(title, country, expected):
    t = parse_note_title(title, country)
    assert (t.topic, t.country, t.month, t.accessible) == expected


def _key(title, country):
    return series_key(parse_note_title(title, country))


@pytest.mark.parametrize("a, b, country", [
    ("Country policy and information note: sexual orientation and gender identity and expression, Pakistan, April 2022",
     "Country policy and information note: sexual orientation and gender identity or expression, Pakistan, May 2025", "Pakistan"),
    ("Country policy and information note: medical treatment and healthcare, Kenya, July 2022",
     "Country policy and information note: healthcare and medical treatment, Kenya, May 2026", "Kenya"),
    ("Country information note: blood feuds, Albania, February 2020",
     "Country policy and information note: blood feuds, Albania, September 2022", "Albania"),
    ("Country policy and information note: actors of protection, Colombia, January 2025 (accessible)",
     "country-policy-and-information-note-actors-of-protection-columbia-january-2025-accessible", "Colombia"),
])
def test_drifting_titles_stay_in_one_series(a, b, country):
    assert _key(a, country) == _key(b, country)


def test_renamed_report_keeps_its_lineage():
    assert _key("Country policy and information note: Hong Kong national security law, China, June 2022", "China") == \
        _key("Country policy and information note: Hong Kong national security legislation, China, April 2025", "China")


def test_bulletins_are_kept_apart_from_cpins_on_the_same_topic():
    assert _key("Country bulletin Iran: security situation, March 2026", "Iran") != \
        _key("Country policy and information note: security situation, Iran, March 2026", "Iran")


def test_editions_of_one_report_share_a_key():
    a = _key("Country policy and information note: fear of the Taliban, Afghanistan, February 2022 (accessible)", "Afghanistan")
    b = _key("Country policy and information note: fear of the Taliban, Afghanistan, August 2025 (accessible)", "Afghanistan")
    assert a == b


def test_different_reports_have_different_keys():
    a = _key("Country policy and information note: actors of protection, Kenya, July 2026", "Kenya")
    b = _key("Country policy and information note: internal relocation, Kenya, July 2026", "Kenya")
    assert a != b
