"""Near-match alignment of quotations: faithful shapes that must stay quiet, and changes that must not."""
from cpin import mechanical as m

URL = 'https://example.org/source'
SURVEY = ('Intro sentence here. The detailed country survey, which was carried out by the national statistics office with support from two '
          'international agencies, found that 281 people from the village returned to their original homes during the reporting period, '
          'not 2023. Next sentence follows here.')
SHELTERS = ('The total recorded was 300. Most of the displaced families were still living in temporary shelters at the end of the year, '
            'not 40 tents. Officials did not comment.')


def doc(text):
    return {'sha256': 'a' * 64, 'extractionSha256': 'b' * 64, 'norm': m.normal(text), 'kind': 'html', 'second': None}


def candidates(quote, source):
    return {c['rule'] for c in m.quotation_checks('‘' + quote + '’', doc(source), URL) if c['state'] == 'candidate'}


def test_bracketed_ellipsis_is_an_ellipsis():
    source = ('The detailed country survey found that 281 people did not return to their original homes during the reporting period. '
              'The figure was revised in 2023. Aid agencies reported that most displaced families were still living in temporary '
              'shelters at the end of the year.')
    first, last = source.split(' The figure was revised in 2023. ')
    for gap in (' […] ', ' [...] ', ' (…) ', ' … '):
        assert candidates(first + gap + last, source) == set()
        assert 'changed-number' in candidates(first.replace('281', '218') + gap + last, source)


def test_faithful_bracketed_quotation_that_stops_mid_sentence_stays_quiet():
    quote = ('he detailed country survey, which was carried out by the national statistics office with support from two international '
             'agencies, found that 281 people from the village returned to their original homes during the reporting period')
    assert candidates('[T]' + quote, SURVEY) == set()
    assert candidates('T' + quote.replace('homes', 'homes [sic]'), SURVEY) == set()
    assert 'changed-number' in candidates('[T]' + quote.replace('281', '218'), SURVEY)


def test_a_changed_end_word_is_compared_with_the_same_number_of_source_words():
    quote = 'Most of the displaced families were still living in temporary shelters at the close'
    assert candidates(quote, SHELTERS) == {'quotation-near-match'}
    quote = 'Many of the displaced families were still living in temporary shelters at the end of the year'
    assert candidates(quote, SHELTERS) == {'quotation-near-match'}
    negated = 'They did not. ' + SHELTERS.split('. ', 1)[1]
    assert candidates(quote, negated) == {'quotation-near-match'}


def test_brackets_never_produce_a_finding_of_their_own():
    base = ('The detailed country survey, which was carried out by the national statistics office with support from two international '
            'agencies, found that 281 people from the village returned to their original homes during the reporting period')
    for edited in (base.replace('homes', 'homes [5]'), base.replace('village', 'village[s]'), base.replace('during the', 'during [a]'),
                   base.replace('returned to', '[went back] to')):
        assert candidates(edited, SURVEY) == set(), edited
    # ... but a substitution is left unassessed, never passed as formatting.
    checks = m.quotation_checks('‘' + base.replace('returned to', '[went back] to') + '’', doc(SURVEY), URL)
    assert [c['state'] for c in checks if c['rule'] == 'quotation-near-match'] == ['unable']
    assert m.near_quote(m.normal(SURVEY), base.replace('homes', 'homes [5]')) is None


def test_a_bracket_never_hides_a_figure_or_a_negation():
    base = ('The detailed country survey, which was carried out by the national statistics office with support from two international '
            'agencies, found that 281 people from the village returned to their original homes during the reporting period')
    # A real change one word from an innocent bracket.
    for edited in (base.replace('281 people', '218 [sic] people'), base.replace('281 people', '218 people [sic]'),
                   base.replace('found that 281', 'found [sic] that 218')):
        assert 'changed-number' in candidates(edited, SURVEY), edited
    negated = SURVEY.replace('returned to', 'did not return to')
    for edited in (base.replace('returned to', 'did return [sic] to'), base.replace('village returned', 'village [sic] did return')):
        assert 'changed-negation' in candidates(edited, negated), edited
    # The quoting author's own bracket replacing a figure or unit is reported too: a reviewer decides.
    assert 'changed-number' in candidates(base.replace('281 people', '[many] people'), SURVEY)
    assert 'changed-unit' in candidates(base.replace('281 people', '281 [individuals]'), SURVEY)
    # Number words, scale words, qualifiers and contractions beside a bracket are judged as they would be without it.
    scaled = SURVEY.replace('281 people', 'at least 281 thousand people').replace('returned', 'won’t return')
    quoted = base.replace('281 people', 'at least 281 thousand people').replace('returned', 'won’t return')
    assert 'changed-unit' in candidates(quoted.replace('281 thousand', '281 million [sic]'), scaled)
    assert 'changed-qualifier' in candidates(quoted.replace('at least', 'at most [sic]'), scaled)
    hidden = m.quotation_checks('‘' + quoted.replace('won’t return', 'will [sic] return') + '’', doc(scaled), URL)
    assert [c['state'] for c in hidden if c['rule'] == 'quotation-near-match'] == ['unable']
    words = SURVEY.replace('281 people', 'twelve people')
    assert 'changed-number' in candidates(base.replace('281 people', 'twenty [sic] people'), words)


def test_a_figure_cut_off_at_the_quotations_full_stop_is_reported():
    stem = 'Officials said that most of the displaced families from the northern districts were still living in shelters and that the total was '
    for tail, rule in (('4 000.', 'changed-number'), ('4 million.', 'changed-unit'), ('4 per cent.', 'changed-unit'), ('4 at most.', 'changed-qualifier')):
        assert rule in candidates(stem + '4.', stem + tail + ' Next came 99 more.'), tail
    # A quotation that simply stops mid-sentence, without a full stop of its own, claims nothing about what follows.
    assert candidates(stem + '4', stem + '4 at most. Next came 99 more.') <= {'quotation-near-match'}


def test_a_negation_cut_off_at_the_quotations_full_stop_is_reported():
    source = ('Officials said that most of the displaced families from the northern districts were still living in shelters and that 40 did not. '
              'Next came 99 more.')
    quote = 'Officials said that most of the displaced families from the northern districts were still living in shelters and that 40 did.'
    assert 'changed-negation' in candidates(quote, source)


def test_percent_sign_at_the_start_matches_the_words():
    source = 'Intro. 12 per cent of the displaced families from the northern districts who were still living in shelters at the end. Next.'
    quote = '12% of the displaced families from the northern districts who were still living in shelters at the end.'
    assert candidates(quote, source) == set()
    assert 'changed-number' in candidates(quote.replace('12%', '21%'), source)


def test_apostrophes_extend_a_quotation_only_when_that_is_safe():
    real = 'they will not be allowed to return to their homes ever'
    assert m.quotations('It called them ‘terrorists’and said ‘' + real + '’ on Monday.') == [real]
    assert m.quotations('The ‘Jama’at group said ‘' + real + '’ on Monday.') == [real]
    long = 'the agency reported that most of the people in the territory’s north were displaced'
    assert m.quotations('It said ‘' + long + '’ last week.') == [long]
    # The longer reading never runs into a double-quoted quotation or closes on an apostrophe.
    double = 'the army’s soldiers didn’t leave the city until the following month'
    assert m.quotations('The ‘Jama’at’s leader told reporters: “' + double + '” yesterday.') == [double]
    assert m.quotations('It called them ‘terrorists’and said “' + double + '” on Monday.') == [double]
    assert m.quotations('The ‘Ba’ath’s leader told reporters: "' + double + '" yesterday.') == [double]
    assert m.quotations('It called them ‘terrorists’and said they didn’t go, adding ‘' + real + '’.') == [real]


def test_a_bracket_does_not_excuse_a_change_elsewhere():
    base = ('The detailed country survey, which was carried out by the national statistics office with support from two international '
            'agencies, found that 281 people from the village returned to their original homes during the reporting period')
    assert candidates(base.replace('survey,', 'survey [sic],').replace('agencies', 'charities'), SURVEY) == {'quotation-near-match'}
    assert 'changed-number' in candidates(base.replace('survey,', 'survey [sic],').replace('281', '218'), SURVEY)
    assert 'changed-negation' in candidates(base.replace('homes', 'homes [sic]').replace('people from', 'people not from'), SURVEY)


def test_many_repeats_of_the_anchor_do_not_hide_a_changed_first_figure():
    filler = 'The checkpoint remains closed to ordinary residents. ' * 20
    source = filler + 'Nearly 65 per cent of the land in the territory is now restricted, and most of it remains closed to ordinary residents.'
    quote = 'Nearly 95 per cent of the land in the territory is now restricted, and most of it remains closed to ordinary residents.'
    assert 'changed-number' in candidates(quote, source)
