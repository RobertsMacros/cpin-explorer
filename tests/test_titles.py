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


def test_albania_trafficking_and_nigeria_sogie_keep_their_lineage():
    # Version numbers show one report each: v11.0 -> v14.0, and v3.0 -> v4.0.
    assert _key("Country policy and information note: trafficking, Albania, September 2022 (accessible)", "Albania") == \
        _key("Country policy and information note: human trafficking, Albania, February 2023 (accessible)", "Albania")
    assert _key("Country policy and information note: sexual orientation and gender identity or expression, Nigeria, February 2022 (accessible version)", "Nigeria") == \
        _key("Country policy and information note: sexual orientation, gender identity and expression, and sex characteristics, Nigeria, June 2025 (accessible)", "Nigeria")
    # The bulletin on the same subject is a separate product and stays apart.
    assert _key("Country bulletin: human trafficking, Albania, August 2026 (accessible)", "Albania") != \
        _key("Country policy and information note: human trafficking, Albania, February 2023 (accessible)", "Albania")


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


def test_a_fact_finding_report_titled_without_a_colon_is_still_a_fact_finding_report():
    for title, country in (("Report of a Home Office fact-finding mission to Sri Lanka, January 2020", "Sri Lanka"),
                           ("Report of a Home Office fact-finding mission, Vietnam, September 2019", "Vietnam")):
        parsed = parse_note_title(title, country)
        assert (parsed.kind, parsed.topic, parsed.country) == ("report of a fact-finding mission", "Home Office fact-finding mission", country)
        assert series_key(parsed) == "fact-finding:fact-finding-home-mission-office"
    # One with a topic keeps it, as before.
    assert parse_note_title("Report of a fact-finding mission: human trafficking, Albania, December 2022", "Albania").topic == "human trafficking"


@pytest.mark.parametrize("title, country, topic, key", [
    # Titles of editions GOV.UK no longer lists, as archived country pages show them (recover.py): the country
    # first, a comma for the colon, an earlier name of the country, or no topic at all.
    ("Country policy and information note: Afghanistan, Hindus and Sikhs, March 2021", "Afghanistan", "Hindus and Sikhs", "note:hindus-sikhs"),
    ("Country policy and information note: Iraq 'honour' crimes, March 2021", "Iraq", "'honour' crimes", "note:crimes-honour"),
    ("Country policy and information note: Sri Lanka medical treatment and healthcare, July 2020", "Sri Lanka",
     "medical treatment and healthcare", "note:healthcare-medical"),
    ("Country Policy and Information Note, Russia, sexual orientation and gender identity or expression, November 2020", "Russia",
     "sexual orientation and gender identity or expression", "note:expression-gender-identity-orientation-sexual"),
    ("Country background note: Egypt, December 2020", "Egypt", "background note", "note:background-note"),
    ("Country policy and information note: background information, including actors of protection, and internal relocation, OPT, December 2018",
     "Palestine", "background information, including actors of protection, and internal relocation",
     "note:actors-background-information-internal-protection-relocation"),
    ("Country policy and information note: humanitarian situation in Gaza, Occupied Palestinian Territories, November 2024", "Palestine",
     "humanitarian situation in Gaza", "note:gaza-humanitarian-situation"),
])
def test_titles_of_editions_no_longer_listed(title, country, topic, key):
    parsed = parse_note_title(title, country)
    assert (parsed.topic, series_key(parsed)) == (topic, key)


def test_the_combined_gaza_note_is_an_earlier_edition_of_the_humanitarian_report():
    """v2.0 of March 2019 covered security and the humanitarian situation; v3.0 of July 2022 is 'the humanitarian
    situation in Gaza'. One lineage by the version numbers, so one report."""
    v2 = parse_note_title("Country policy and information note: security and humanitarian situation, OPT (Gaza), March 2019", "Palestine")
    assert (v2.topic, v2.country, v2.month) == ("security and humanitarian situation (Gaza)", "OPT", "2019-03")
    v3 = parse_note_title("Country policy and information note: the humanitarian situation in Gaza, July 2022 (accessible)", "Palestine")
    assert series_key(v2) == series_key(v3) == "note:gaza-humanitarian-situation"
    security = parse_note_title("Country policy and information note: security situation in Gaza, Palestine, November 2024", "Palestine")
    assert series_key(security) == "note:gaza-security-situation"


def test_a_country_named_twice_keeps_the_address_its_report_already_has():
    live = parse_note_title("Country policy and information note: Iraq Blood feuds, honour crimes and tribal violence, Iraq, July 2024 (accessible)", "Iraq")
    assert live.topic == "Blood feuds, honour crimes and tribal violence"
    assert series_key(live) == "note:blood-crimes-feuds-honour-iraq-tribal-violence"      # as before: saved highlights point at it
    # A country's name inside a topic is left alone: only a leading one is the country.
    assert parse_note_title("Country policy and information note: Rohingya (including Rohingya in Bangladesh), Burma, January 2026",
                            "Myanmar (Burma)").topic == "Rohingya (including Rohingya in Bangladesh)"
