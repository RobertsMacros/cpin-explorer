"""Deterministic, private source-use screening. No fetching, model or publication.

All matches are scoped observations. Candidate discrepancies require inspection;
missing matches are not evidence of false claims. Canonical CPINs are untouched.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from lxml import html
from .source_collect import source_quality
from .webpdf import read_pdf_second
from .store import atomic_write

METHOD = 'mechanical-source-use-v3'
MAX_TEXT = 2_000_000
RULES = {
    'reference-target': 'Footnote reference resolves in the retained index',
    'duplicate-reference': 'Duplicate footnote IDs/markers',
    'source-url-boundary': 'Possible punctuation or line-wrap in source URL',
    'bibliography-link': 'Source URL also occurs in the edition bibliography',
    'bibliography-date': 'Footnote and bibliography explicit publication dates',
    'source-retrieval': 'Recorded source retrieval outcome',
    'source-redirect': 'Recorded redirect destination',
    'source-integrity': 'Retained source bytes match their SHA256',
    'source-readable': 'Usable source text rather than error/challenge response',
    'source-scan-limit': 'Whole source text fits the bounded first-pass scan',
    'citation-title': 'Candidate cited title in source front matter',
    'document-edition-year': 'Highly similar document titles name different years',
    'identifier-conflict': 'Different unique stable identifiers in front matter',
    'source-extraction-recovery': 'Missing inline glossary terms recovered from uniquely anchored original HTML',
    'citation-title-truncation': 'Citation title contains ellipsis',
    'citation-publisher': 'Cited publisher name observed in front matter',
    'publication-date': 'Citation date versus explicit HTML publication metadata',
    'source-future-date': 'Source citation date later than known CPIN edition date',
    'access-before-publication': 'Explicit citation access date before publication',
    'capture-applicability': 'Held source capture versus historical CPIN edition',
    'doi': 'Cited DOI observed in source front matter',
    'isbn': 'Cited ISBN observed in source front matter',
    'isbn-checksum': 'Cited ISBN mathematical checksum',
    'invalid-calendar-date': 'Impossible explicit citation calendar date',
    'case-identifier': 'Neutral case citation/ECLI observed in source',
    'source-html-fragment': 'Cited HTML ID/name fragment exists',
    'source-text-fragment': 'Browser text-fragment excerpt located',
    'source-physical-page': 'Explicit PDF #page target within physical pages',
    'source-printed-page': 'Cited printed page resolved using declared PDF labels',
    'source-paragraph': 'Cited source paragraph number located',
    'quotation-exact': 'Complete candidate quotation located',
    'quotation-ellipsis': 'Quoted segments located in order and gaps retained',
    'quotation-repetition': 'Repeated quotation locations remain ambiguous',
    'quotation-pinpoint': 'Quotation occurs at the resolved source location',
    'quotation-independent-reader': 'PDF text match checked with independent reader',
    'quotation-near-match': 'Bounded comparison with uniquely aligned similar text',
    'near-match-independent-reader': 'Independent PDF reader supports the same aligned differences',
    'changed-number': 'Numbers differ in a bounded near-matching quotation',
    'changed-negation': 'Negation differs in a bounded near-matching quotation',
    'changed-qualifier': 'Bound/estimate wording differs in aligned text',
    'changed-unit': 'Units differ in aligned text',
    'editorial-insertion': 'Square-bracket additions in quoted wording',
    'figure-context': 'Numbers belong to a located quotation, not a global number search',
    'percentage-arithmetic': 'Explicit n out of N percentage within rounding tolerance',
    'impossible-percentage': 'Ordinary explicit percentages outside 0–100',
    'reversed-range': 'Explicit from X to Y ranges ordered where labelled as a range',
    'duplicate-url-citation-date': 'Same source URL given different citation dates in edition',
    'source-pinpoint-present': 'Source pinpoint preserved in comparison inputs',
    'source-content-type': 'PDF-looking address versus retained document type',
    'table-scope': 'Table/cell claims routed away from plain-text approval',
    'legal-scope': 'Legal meaning/version applicability remains contextual',
    'contextual-support': 'Contextual assessment is outside mechanical screening',
    'source-furniture': 'Structurally evidenced source markers/headings excluded from derived comparison',
    'quotation-number-format': 'Aligned numeral formatting differs without changing values',
    'quotation-attribution': 'Omitted source attribution remains a contextual question',
    'quotation-unit-scope': 'Missing percentage notation needs contextual interpretation',
}

MONTHS = 'January February March April May June July August September October November December'.split()
DATE_RE = re.compile(r'\b(\d{1,2})\s+(' + '|'.join(MONTHS) + r')\s+(\d{4})\b', re.I)
NUMBER = re.compile(r'(?<!\w)[−+-]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*%)?(?!\w)')
NEGATION = re.compile(r"\b(?:not|no|never|neither|without|cannot|can't|didn't|doesn't|isn't|wasn't)\b", re.I)
QUALIFIER = re.compile(r'\b(?:at least|at most|up to|approximately|estimated|estimate|reportedly|alleged|some|may|could|likely|unlikely)\b', re.I)
UNIT = re.compile(r'\b(?:per cent|percent|percentage|people|persons|families|households|deaths|cases|incidents|million|billion|thousand|days|months|years|dollars|pounds)\b|[%£$€]', re.I)
DOI = re.compile(r'\b10\.\d{4,9}/[^\s<>"\]]+', re.I)
ISBN = re.compile(r'\bISBN(?:-1[03])?\s*:?\s*([\dXx][\dXx -]{8,20}[\dXx])')
CASE = re.compile(r'\[\d{4}\]\s+(?:UKUT|UKSC|EWCA|EWHC|UKIAT|UKAIT)\s+(?:[A-Z]+\s+)?\d+|\bECLI:[A-Z0-9:._-]+', re.I)
BIB_SECTIONS = {'Sources cited', 'Sources consulted but not cited', 'Bibliography'}
OCCURRENCE_RULES = {'reference-target', 'duplicate-reference', 'source-future-date', 'capture-applicability', 'duplicate-url-citation-date'}
EXPONENT_BASES = {'km', 'cm', 'mm', 'm', 'metres', 'meters', 'log', 'ln', 'x', 'y', 'z'}


def digest_json(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def normal(text):
    # Preserve punctuation, minus signs, numbers and all words. Case/spacing and
    # typographic quotation marks are the only transformations for quotation search.
    text = unicodedata.normalize('NFKC', text).translate(str.maketrans({'‘': "'", '’': "'", '“': '"', '”': '"', '\u00ad': ''}))
    return ' '.join(text.casefold().split())


def claim_text(claim):
    text = claim['text']
    paragraph = claim.get('paragraph') or ''
    if paragraph and re.match(r'^' + re.escape(paragraph) + r'(?=\s)', text):
        text = text[len(paragraph):]
    return re.sub(r'\[footnote\s+\d+\]', '', text, flags=re.I).strip()


def dates(text):
    result = []
    for match in DATE_RE.finditer(text):
        d, m, y = match.groups()
        try:
            result.append(date(int(y), next(i for i, x in enumerate(MONTHS, 1) if x.casefold() == m.casefold()), int(d)).isoformat())
        except ValueError:
            pass
    return result


def citation(cite):
    main, *access = re.split(r'\b(?:last\s+)?accessed\b(?:\s+on)?', cite, flags=re.I)
    quoted = [m[0] or m[1] or m[2] for m in re.findall(r'‘([^’]+)’|“([^”]+)”|"([^\"]+)"', main)]
    quoted = [s for s in quoted if len(s.split()) >= 3 and len(s) >= 15]
    title = quoted[0] if len(quoted) == 1 else None
    found = list(DATE_RE.finditer(main))
    if not quoted and len(found) == 1 and ',' in main[:found[0].start()]:
        title = main[:found[0].start()].split(',', 1)[1].strip(' ,.;')
        if len(title.split()) < 3:
            title = None
    # A pinpoint appearing before the date is not part of the document title.
    if title:
        title = re.sub(r'\s*\((?:p(?:age)?s?\.?|paragraphs?|paras?\.?)\s+[^)]*\)\s*$', '', title, flags=re.I)
    page = re.findall(r'\b(?:pp?\.|pages?)\s*(\d+)(?:\s*[-–]\s*(\d+))?', main, re.I)
    para = re.findall(r'\b(?:paragraphs?|paras?\.?)\s+(\d+(?:\.\d+)*)', main, re.I)
    return {'title': title, 'publisher': main.split(',', 1)[0].strip() if ',' in main else None,
            'publicationDates': dates(main), 'accessDates': dates(' '.join(access)),
            'pages': page, 'paragraphs': para, 'dois': doi_values(main),
            'isbns': ISBN.findall(main), 'cases': CASE.findall(main)}


def doi_values(text):
    values = []
    for value in DOI.findall(text):
        value = value.rstrip('.,;:')
        while value.endswith(')') and value.count(')') > value.count('('):
            value = value[:-1]
        values.append(value)
    return values


def quotations(text):
    text = re.sub(r'\[footnote\s+\d+\]', '', text, flags=re.I).strip()
    found = []
    if text.startswith(('‘', '“')):
        close = '’' if text[0] == '‘' else '”'
        end = text.rfind(close)
        if end > 0:
            found.append(text[1:end])
    if not found:
        for match in re.finditer(r'“([^”]+)”|‘([^’]+)’|"([^\"]+)"', text):
            value = next(x for x in match.groups() if x is not None)
            if len(value.split()) >= 8:
                found.append(value)
    # Only complete, bounded spans are compared. Long blocks remain unassessed.
    return list(dict.fromkeys(q for q in found if 8 <= len(q.split()) <= 300))[:6]


def locate(text, quote):
    parts = [normal(p).strip() for p in re.split(r'…|\.{3}', quote) if normal(p).strip()]
    if not parts or any(len(p.split()) < 4 for p in parts):
        return {'state': 'unable', 'reason': 'short or ambiguous quotation segments'}
    at = 0
    locations = []
    for part in parts:
        pos = text.find(part, at)
        if pos < 0:
            return {'state': 'unable', 'reason': 'quoted wording not located; not proof of absence'}
        locations.append((pos, pos + len(part)))
        at = pos + len(part)
    if len(parts) > 1 and locations[-1][1] - locations[0][0] > max(4000, len(quote) * 4):
        return {'state': 'unable', 'reason': 'segments too widely separated for bounded alignment'}
    return {'state': 'pass', 'segments': locations,
            'occurrencesOfFirstSegment': text.count(parts[0]),
            'gaps': [text[a[1]:b[0]][:1600] for a, b in zip(locations, locations[1:])],
            'excerpt': text[max(0, locations[0][0] - 180):locations[-1][1] + 180][:3000]}


def near_quote(text, quote):
    """Only compare a short window bracketed by exact first/last four tokens."""
    q = normal(quote)
    if '…' in quote or '...' in quote or '[' in quote or len(q.split()) < 12:
        return None
    words = q.split()
    first, last = ' '.join(words[:4]), ' '.join(words[-4:])
    candidates = {}
    pos = text.find(first)
    for _ in range(12):
        if pos < 0:
            break
        end = text.find(last, pos + len(first), min(len(text), pos + max(500, int(len(q) * 1.5))))
        if end >= 0:
            candidate = text[pos:end + len(last)]
            ratio = SequenceMatcher(None, words, candidate.split(), autojunk=False).ratio()
            q_values, s_values = quantity_texts(q, candidate)
            ratio = max(ratio, SequenceMatcher(None, format_words(q_values).split(), format_words(s_values).split(), autojunk=False).ratio())
            if ratio >= .90 and candidate != q:
                candidates[candidate] = {'excerpt': candidate, 'offset': pos, 'similarity': round(ratio, 4)}
        pos = text.find(first, pos + len(first))
    ranked = sorted(candidates.values(), key=lambda x: x['similarity'], reverse=True)
    if not ranked or (len(ranked) > 1 and ranked[0]['similarity'] - ranked[1]['similarity'] < .03):
        return None
    best = ranked[0]
    best['differences'] = []
    source_words = best['excerpt'].split()
    for tag, a, b, c, d in SequenceMatcher(None, words, source_words, autojunk=False).get_opcodes():
        if tag != 'equal':
            best['differences'].append({'quoted': ' '.join(words[a:b]), 'source': ' '.join(source_words[c:d])})
    best['changed'] = {k: regex.findall(q) != regex.findall(best['excerpt'])
                       for k, regex in [('number', NUMBER), ('negation', NEGATION), ('qualifier', QUALIFIER), ('unit', UNIT)]}
    quoted_values, source_values = quantity_texts(q, best['excerpt'])
    best['changed']['number'] = number_values(quoted_values) != number_values(source_values)
    best['numberFormatOnly'] = quoted_values != q or source_values != best['excerpt']
    # A misspelt unit remains a wording question, rather than a claim that the
    # numerical scale changed. Both recognised units must still be compared.
    unit_q = quoted_values
    unit_words = {'million', 'billion', 'thousand', 'people', 'persons', 'families', 'households', 'deaths', 'cases', 'incidents', 'days', 'months', 'years', 'dollars', 'pounds'}
    for difference in best['differences']:
        a, b = re.findall(r'\w+', difference['quoted']), re.findall(r'\w+', difference['source'])
        if len(a) == len(b) == 1 and a[0] not in unit_words and b[0] in unit_words and SequenceMatcher(None, a[0], b[0]).ratio() >= .85:
            unit_q = re.sub(r'\b' + re.escape(a[0]) + r'\b', b[0], unit_q)
    best['changed']['unit'] = numerical_units(unit_q) != numerical_units(source_values) or any(
        number_values(d['quoted']) and number_values(d['quoted']) == number_values(d['source'])
        and numerical_units(d['quoted']) != numerical_units(d['source']) for d in best['differences'])
    if number_values(unit_q) == number_values(source_values):
        best['changed']['unit'] |= quantity_units(unit_q) != quantity_units(source_values)
    best['formatEquivalent'] = format_words(quoted_values) == format_words(source_values)
    return best


SMALL_NUMBERS = dict(zip(('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen').split(), range(20)))
SMALL_NUMBERS.update(dict(zip(('twenty thirty forty fifty sixty seventy eighty ninety').split(), range(20, 100, 10))))
ONES = '|'.join(list(SMALL_NUMBERS)[:10])
TENS = '|'.join(list(SMALL_NUMBERS)[20:])
WORD_NUMBER = re.compile(r'\b(?:(' + ONES + r') hundred(?: and)?(?: (?:' + TENS + r')(?:[- ](?:' + ONES + r'))?| (?:' + '|'.join(list(SMALL_NUMBERS)[:20]) + r'))?|(?:' + TENS + r')(?:[- ](?:' + ONES + r'))?|' + '|'.join(list(SMALL_NUMBERS)[:20]) + r')\b')


def quantity_texts(quoted, source):
    """Derived quantity comparison only; literal quotation text is untouched.

    Space grouping needs a comma-grouped counterpart. Decimal commas with three
    trailing digits are deliberately not interpreted as decimals. Bounded English
    number phrases cover 0–999; a bare 'one' needs a digit counterpart or unit.
    """
    results = []
    for text, other in ((quoted, source), (source, quoted)):
        digits = set(NUMBER.findall(other))
        digits = {v.replace(',', '').rstrip('%').strip().lstrip('+') for v in digits}
        def numeral(match):
            phrase = match.group()
            if phrase == 'one' and '1' not in digits and not re.match(r'\s+(?:hundred|thousand|million|billion|people|persons|cases|days|months|years)\b', text[match.end():]):
                return phrase
            value = 0
            for word in phrase.replace('-', ' ').split():
                if word == 'hundred':
                    value *= 100
                elif word != 'and':
                    value += SMALL_NUMBERS[word]
            return str(value)
        text = WORD_NUMBER.sub(numeral, text)
        for match in list(re.finditer(r'(?<![\w.,])\d{1,3}(?: \d{3})+(?!\d|[.,]\d)', text))[::-1]:
            value = match.group().replace(' ', '')
            # A sequence of separate numbers is not assumed to be a grouping.
            counterpart = re.search(r'(?<!\w)' + re.escape(f'{int(value):,}') + r'(?!\w)', other)
            if counterpart:
                text = text[:match.start()] + value + text[match.end():]
        text = re.sub(r'(?<![\w.,])([−+-]?\d+),(\d{1,2})(?!\d|[.,]\d)', r'\1.\2', text)
        text = re.sub(r'(?<!\w)\d{1,3}(?:,\d{3})+(?!\d)', lambda m: m.group().replace(',', ''), text)
        results.append(text)
    return results


def format_words(text):
    # Punctuation typography only. Mathematical signs, slash, currency and
    # percentage survive; words, quantities, qualifiers and order survive.
    text = re.sub(r'([%£$€])', r' \1 ', text)
    return re.sub(r'\s+', ' ', re.sub(r'[\"\'“”‘’.,;:()–—]', ' ', text)).strip()


def number_values(text):
    # A missing percent sign is a unit/wording question, not a changed digit.
    return [value.rstrip('%').strip() for value in NUMBER.findall(text)]


def numerical_units(text):
    """Population words count as units only when attached to a numerical value."""
    number = r'[−+-]?\d+(?:,\d{3})*(?:\.\d+)?'
    units = r'per cent|percent|percentage|people|persons|families|households|deaths|cases|incidents|million|billion|thousand|days|months|years|dollars|pounds'
    return re.findall(r'(?:' + number + r'\s*(' + units + r'|%)(?!\w))|([£$€])\s*' + number, text, re.I)


def quantity_units(text):
    """Associate recognised units with ordered numerical slots, including gaps."""
    slots = []
    for match in NUMBER.finditer(text):
        following = re.match(r'\s*(per cent|percent|percentage|people|persons|families|households|deaths|cases|incidents|million|billion|thousand|days|months|years|dollars|pounds)\b', text[match.end():])
        currency = re.search(r'([£$€])\s*$', text[:match.start()])
        slots.append('%' if match.group().rstrip().endswith('%') else following[1] if following else currency[1] if currency else None)
    return slots


def arithmetic(text):
    # Percent escapes in addresses are not reported statistical values.
    text = re.sub(r'https?://\S+', ' ', text)
    checks = []
    pattern = r'\b(\d[\d,]*)\s+(?:out of|of)\s+(\d[\d,]*)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:%|per cent|percent)\s*\)'
    for match in re.finditer(pattern, text, re.I):
        n, total, percentage = match.groups()
        n, total = int(n.replace(',', '')), int(total.replace(',', ''))
        precision = len(percentage.partition('.')[2])
        if total == 0:
            checks.append({'rule': 'percentage-arithmetic', 'state': 'candidate', 'evidence': match.group(), 'reason': 'zero stated denominator'})
            continue
        actual = 100 * n / total
        tolerance = .5 * 10 ** (-precision) + 1e-9
        delta = abs(actual - float(percentage))
        coarse = total <= 10 and delta <= 50 / total + tolerance and not re.search(r'\bexact(?:ly)?\b', text[max(0, match.start()-60):match.end()], re.I)
        state = 'pass' if delta <= tolerance else 'observation' if coarse else 'candidate'
        checks.append({'rule': 'percentage-arithmetic', 'state': state,
                       'reason': 'small-denominator ratio may be an approximate rendering' if state == 'observation' else 'explicit arithmetic only; input basis unverified',
                       'evidence': match.group(), 'calculated': actual, 'roundingTolerance': tolerance})
    for match in re.finditer(r'(?<![\w.])([−-]?\d+(?:\.\d+)?)\s*(?:%|per cent\b|percent\b)', text, re.I):
        value = float(match[1].replace('−', '-'))
        if value < 0 and re.search(r'\d\s*%\s*$', text[:match.start()]):
            value = abs(value)  # 26%-50% is a range, not a negative share.
        if value < 0 or value > 100:
            context = text[max(0, match.start()-120):match.end()+80]
            relative = re.search(r'\b(?:increase|increased|growth|grew|rise|rose|decline|decrease|change|higher|lower|more than|less than)\b', context, re.I)
            checks.append({'rule': 'impossible-percentage', 'state': 'observation' if relative else 'candidate', 'evidence': match.group(),
                           'reason': 'outside 0–100; growth/change percentages may legitimately exceed these bounds'})
    for match in re.finditer(r'\brange(?:d|s)?\s+from\s+(\d+(?:,\d{3})*(?:\.\d+)?)(?![\d,.])\s+to\s+(\d+(?:,\d{3})*(?:\.\d+)?)(?![\d,.])\b', text, re.I):
        if float(match[1].replace(',', '')) > float(match[2].replace(',', '')):
            checks.append({'rule': 'reversed-range', 'state': 'candidate', 'evidence': match.group()})
    return checks


def stat_key(path):
    try:
        st = Path(path).stat()
        return [st.st_size, st.st_mtime_ns]
    except FileNotFoundError:
        return None


def declared_labels(pdf):
    """Only label covered intervals; uncovered pages have no inferred label."""
    rules = pdf.get_page_labels()
    labels, uncovered = {}, []
    if not rules:
        return labels, uncovered
    for i, page in enumerate(pdf):
        if not any(r.get('startpage', 0) <= i for r in rules):
            if rules:
                uncovered.append(i + 1)
            continue
        try:
            label = page.get_label()
        except (IndexError, ValueError, RuntimeError):
            uncovered.append(i + 1)
            continue
        if label:
            labels[str(i + 1)] = label
    return labels, uncovered


def pdf_note_markers(page, endnotes=()):
    """Raised numeric spans with a matching bottom-of-page note, never bare digits."""
    lines = [line['spans'] for b in page.get_text('dict')['blocks'] for line in b.get('lines', [])]
    notes = set(endnotes)
    for spans in lines:
        if spans and not spans[0]['flags'] & 1 and spans[0]['bbox'][1] > page.rect.height * .65:
            match = re.match(r'^(\d{1,4})\s+\S', ''.join(s['text'] for s in spans).strip())
            if match:
                notes.add(match[1])
    markers = []
    flat = [s for spans in lines for s in spans]
    for i, span in enumerate(flat):
        value = span['text'].strip()
        if value not in notes or not span['flags'] & 1 or not 0 < i < len(flat)-1:
            continue
        before = next((normal(s['text'])[-50:] for s in reversed(flat[:i]) if normal(s['text'])), '')
        after = next((normal(s['text'])[:50] for s in flat[i+1:] if normal(s['text'])), '')
        # A legal provision (239¹), exponent or numerical suffix is not a
        # prose reference, even if a note with that number exists elsewhere.
        last_word = re.findall(r'\w+', before)[-1:] or ['']
        if before and after and re.search(r'[a-z]', before) and not re.search(r'\d\s*$', before) and last_word[0] not in EXPONENT_BASES:
            markers.append({'marker': value, 'before': before, 'after': after})
    return markers


def pdf_endnotes(pdf):
    notes, started = set(), False
    size = 0
    for page in pdf:
        text = page.get_text()
        size += len(text)
        if size > MAX_TEXT:
            break
        if re.search(r'^\s*(?:endnotes|notes|references)\s*$', text, re.I | re.M):
            started = True
        entries = re.findall(r'^\s*(\d{1,4})[.\t ]+[^\d\s]', text, re.M)
        # Some publishers leave the final note list untitled. Require a run of
        # numbered entries and bibliographic links, not a lone numeral/table.
        if len(set(entries)) >= 3 and len(re.findall(r'https?://|\bavailable at\b', text, re.I)) >= 3:
            started = True
        if started:
            notes.update(entries)
    return notes


def pdf_bottom_notes(page, markers):
    """Retain bottom notes separately when matching raised references exist."""
    ids = {m['marker'] for m in markers}
    notes = []
    blocks = page.get_text('dict')['blocks']
    body_sizes = [s['size'] for b in blocks for line in b.get('lines', []) for s in line['spans']
                  if s['text'].strip() and not s['flags'] & 1 and s['bbox'][1] < page.rect.height * .65]
    if not body_sizes:
        return notes
    body_size = sorted(body_sizes)[len(body_sizes)//2]
    for block in blocks:
        lines = block.get('lines', [])
        if not lines or block['bbox'][1] <= page.rect.height * .65:
            continue
        text = normal(' '.join(''.join(s['text'] for s in line['spans']) for line in lines))
        match = re.match(r'^(\d{1,4})\s+\S', text)
        sizes = [s['size'] for line in lines for s in line['spans'] if s['text'].strip()]
        if match and match[1] in ids and len(text.split()) >= 4 and max(sizes) <= body_size * .9:
            notes.append(text)
    return notes


def remove_notes(text, markers):
    value = normal(text)
    removed = []
    for item in markers:
        pattern = re.escape(item['before']) + r'\s*' + re.escape(item['marker']) + r'\s*' + re.escape(item['after'])
        # A repeated anchored context is ambiguous, not permission to remove all.
        count = len(re.findall(pattern, value))
        if count != 1:
            continue
        value = re.sub(pattern, lambda _: item['before'] + ' ' + item['after'], value, count=1)
        if count:
            removed.append({**item, 'occurrences': count})
    return normal(value), removed


def html_headings(tree):
    headings = []
    for el in tree.xpath('//h1|//h2|//h3|//h4|//h5|//h6|//big[strong]'):
        text = normal(el.text_content())
        if 1 <= len(text.split()) <= 14:
            headings.append(text)
    return list(dict.fromkeys(headings))


def recover_inline_glossary(tree, text):
    """Restore only a missing inline glossary label with unique DOM context."""
    value, recoveries = normal(text), []
    for el in tree.xpath('//button[contains(concat(" ", normalize-space(@class), " "), " definition-term__link ")]'):
        parent = el.getparent()
        if parent is None or parent.tag not in {'p', 'span'}:
            continue
        label = normal(el.text_content())
        if not label or len(label.split()) > 8:
            continue
        # Serialize the parent around this exact element, preserving neighbouring
        # inline text. A single matching gap is required; never insert globally.
        placeholder = 'CPINGLOSSARYPLACEHOLDER'
        original = el.text
        children = len(el)
        if children:
            continue
        try:
            el.text = placeholder
            context = normal(' '.join(parent.itertext()))
        finally:
            el.text = original
        before, separator, after = context.partition(placeholder.lower())
        if not separator:
            continue
        left, right = ' '.join(before.split()[-8:]), ' '.join(after.split()[:8])
        gap = normal(left + ' ' + right)
        restored = normal(left + ' ' + label + ' ' + right)
        if len(left.split()) >= 3 and len(right.split()) >= 3 and value.count(gap) == 1 and restored not in value:
            value = value.replace(gap, restored, 1)
            recoveries.append({'label': label, 'before': left, 'after': right})
    return value, recoveries


def html_note_markers(tree):
    markers = []
    ids = set(tree.xpath('//*[@id]/@id | //a[@name]/@name'))
    bracket_notes = set()
    for p in tree.xpath('//p|//li'):
        match = re.match(r'^\s*\[(\d{1,4})\]\s+\S', p.text_content())
        if match:
            bracket_notes.add(match[1])
    elements = tree.xpath('//a[@href] | //sup[not(.//a)]')
    for el in elements:
        label = normal(el.text_content())
        href = el.get('href', '')
        number = re.fullmatch(r'(?:footnote\s*)?\[?(\d{1,4})\]?', label)
        if not number:
            continue
        if el.tag == 'sup':
            if number[1] not in bracket_notes:
                continue
            href = 'bracket-note:' + number[1]
        elif not href.startswith('#') or href[1:] not in ids:
            continue
        parents = list(el.iterancestors())
        if not (el.tag == 'sup' or any(p.tag == 'sup' for p in parents) or re.search(r'(?:^#fn|ftn|edn|footnote|endnote|ref|note|cite)', href, re.I)
                or el.get('role') == 'doc-noteref'):
            continue
        parent = next((p for p in parents if p.tag in {'p','li','div'}), None)
        if parent is None:
            continue
        content = normal(parent.text_content())
        # Ambiguous repeated labels remain untouched.
        if content.count(label) != 1:
            continue
        before, after = content.split(label)
        if el.tag == 'sup' and (re.findall(r'\w+', before)[-1:] or [''])[0] in EXPONENT_BASES:
            continue
        if len(before.split()) + len(after.split()) >= 4:
            markers.append({'marker':label,'before':before[-50:],'after':after[:50], 'target':href})
    return markers


def marker_shaped_difference(near):
    """Unproven marker shapes are gaps, never silently stripped or approved."""
    for d in near['differences']:
        q, s = d['quoted'], d['source']
        # Ignore no real numerical substitution: only inserted bracket references
        # or digits attached after prose sentence punctuation are eligible.
        if re.sub(r'\[\d{1,4}\]', '', s) == q and s != q:
            continue
        if q and re.search(r'[A-Za-z][.!?][\'\"]?$', q) and s.startswith(q) and re.fullmatch(r'\d{1,4}', s[len(q):]):
            continue
        return False
    return bool(near['differences'])


def comparison_text(text, headings):
    value = text
    removed = []
    for heading in headings:
        # Remove only unique, structurally established headings; raw matches are
        # attempted first, so quotations of the heading itself are not lost.
        if value.count(heading) == 1:
            value = value.replace(heading, ' ')
            removed.append({'heading': heading})
    return normal(value), removed


class SourceReader:
    """Hash-checked document readings, bounded in memory and retained privately."""
    def __init__(self, output, reading_cache=None):
        self.output = Path(output)
        self.reading_cache = Path(reading_cache) if reading_cache else None
        (self.output / 'readings').mkdir(parents=True, exist_ok=True)
        self.read = lru_cache(maxsize=12)(self._read)

    def _read(self, cache_path, digest, raw_stat, text_stat):
        cache = Path(cache_path)
        if not re.fullmatch(r'[a-f0-9]{64}', digest or ''):
            return {'problem': 'invalid-source-hash'}
        reader_stat = stat_key(shutil.which('pdftotext') or '/not-installed')
        key = digest_json([METHOD, hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), digest, raw_stat, text_stat, reader_stat])
        saved = self.output / 'readings' / f'{key}.json.gz'
        obj = cache / 'documents' / digest
        if not obj.exists():
            return {'problem': 'source-bytes-missing'}
        with obj.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                return {'problem': 'source-hash-mismatch'}
        text_path = cache / 'text' / f'{digest}.json'
        if not text_path.exists():
            return {'problem': 'source-extraction-missing'}
        raw_text = text_path.read_bytes()
        extraction_sha = hashlib.sha256(raw_text).hexdigest()
        if tuple(stat_key(obj) or ()) != raw_stat or tuple(stat_key(text_path) or ()) != text_stat:
            return {'problem': 'source-changed-since-queue-preparation'}
        if saved.exists():
            try:
                with gzip.open(saved, 'rt', encoding='utf-8') as stream:
                    held = json.load(stream)
                required = {'kind', 'headers', 'norm', 'comparisonNorm', 'pages', 'second', 'bounded', 'furniture', 'pageLabels', 'dates', 'anchors'}
                if isinstance(held, dict) and required <= held.keys() and held.get('sha256') == digest and held.get('extractionSha256') == extraction_sha and held.get('readingSha256') == digest_json({k: v for k, v in held.items() if k != 'readingSha256'}):
                    return held
            except (OSError, ValueError, EOFError):
                pass  # Rebuild only our derived reading, never retained evidence.
        text = json.loads(raw_text)
        if not isinstance(text, dict) or text.get('kind') not in {'pdf', 'html', 'text'}:
            return {'problem': 'unsupported-source-extraction'}
        doc = {'sha256': digest, 'extractionSha256': extraction_sha,
               'kind': text.get('kind'), 'headers': [text.get('title', '')], 'dates': [],
               'anchors': [], 'pageLabels': {}, 'pages': [], 'second': None, 'bounded': False,
               'headings': [], 'furniture': [], 'labelGaps': []}
        html_markers = []
        if text.get('kind') == 'pdf':
            import pymupdf
            with pymupdf.open(obj) as pdf:
                if pdf.is_encrypted:
                    return {'problem': 'source-encrypted'}
                doc['physicalPages'] = pdf.page_count
                doc['pageLabels'], doc['labelGaps'] = declared_labels(pdf)
                size = 0
                markers = {}
                bottom_notes = []
                endnotes = pdf_endnotes(pdf)
                seen = set()
                for p in text.get('pages', []):
                    size += len(p.get('text', ''))
                    if size > MAX_TEXT:
                        doc['bounded'] = True
                        break
                    number = p.get('page')
                    if type(number) is not int or not 1 <= number <= pdf.page_count or number in seen:
                        return {'problem': 'invalid-or-duplicate-extracted-page'}
                    seen.add(number)
                    markers[number] = pdf_note_markers(pdf[number-1], endnotes)
                    cleaned, removed = remove_notes(p.get('text', ''), markers[number])
                    notes = pdf_bottom_notes(pdf[number-1], markers[number])
                    cleaned, note_removals = comparison_text(cleaned, notes)
                    bottom_notes += notes
                    doc['furniture'] += [{'physicalPage': number, **m} for m in removed]
                    doc['furniture'] += [{'physicalPage': number, 'bottomNote': m['heading']} for m in note_removals]
                    doc['pages'].append({'physicalPage': number, 'text': normal(p.get('text', '')), 'comparison': cleaned})
                if not doc['bounded'] and len(seen) != pdf.page_count:
                    return {'problem': 'incomplete-extracted-page-inventory'}
            doc['headers'] += [p.get('text', '') for p in text.get('pages', [])[:3]]
            # Same independent reader used by the established PDF comparison method.
            second = None
            if self.reading_cache:
                old_key = digest_json(['mechanical-source-use-v1', '081aeb1c3232d34bfc0f5d54f643392fd312150c20be6f0a3d963597cfd4c913', digest, raw_stat, text_stat, reader_stat])
                old_path = self.reading_cache / 'readings' / f'{old_key}.json.gz'
                if old_path.exists():
                    try:
                        with gzip.open(old_path, 'rt', encoding='utf-8') as stream:
                            old = json.load(stream)
                        if old.get('sha256') == digest and old.get('extractionSha256') == doc['extractionSha256']:
                            doc['second'] = old.get('second')
                            doc['secondReadingReused'] = doc['second'] is not None
                    except (OSError, ValueError, EOFError):
                        pass
            if doc['second'] is None:
                second = read_pdf_second(obj)
            if second is not None:
                doc['second'] = normal('\n'.join(second)[:MAX_TEXT])
            if doc['second'] is not None:
                # Anchored contexts prove exactly which raised markers are being
                # removed. If the independent text differs, leave it untouched.
                all_markers = [m for ms in markers.values() for m in ms]
                doc['secondComparison'], _ = remove_notes(doc['second'], all_markers)
                doc['secondComparison'], _ = comparison_text(doc['secondComparison'], bottom_notes)
            body = '\n'.join(p['text'] for p in doc['pages'])
            doc['comparisonNorm'] = normal(' '.join(p['comparison'] for p in doc['pages']))
        else:
            body = text.get('text', '')
            doc['bounded'] = len(body) > MAX_TEXT
            body = body[:MAX_TEXT]
            doc['headers'].append(body[:2500])
            if text.get('kind') == 'html':
                tree = html.fromstring(obj.read_bytes())
                doc['headings'] = html_headings(tree)
                html_markers = html_note_markers(tree)
                doc['anchors'] = list(dict.fromkeys(tree.xpath('//*[@id]/@id | //a[@name]/@name')))[:50000]
                for el in tree.xpath('//meta[@content]'):
                    name = (el.get('property') or el.get('name') or '').casefold()
                    value = el.get('content', '')
                    if name in {'og:title', 'twitter:title', 'og:site_name'}:
                        doc['headers'].append(value)
                    if name in {'article:published_time', 'datepublished', 'pubdate', 'dc.date.issued', 'dcterms.issued'} and re.match(r'^\d{4}-\d{2}-\d{2}(?:[T ]|$)', value):
                        doc['dates'].append(value[:10])
        doc['norm'] = normal(body)
        if doc['kind'] != 'pdf':
            recovered, doc['inlineRecoveries'] = recover_inline_glossary(tree, body) if doc['kind'] == 'html' else (doc['norm'], [])
            without_notes, removed = remove_notes(recovered, html_markers)
            doc['comparisonNorm'], doc['furniture'] = comparison_text(without_notes, doc['headings'])
            doc['furniture'] += removed
        doc['quality'] = source_quality({'url': 'https://source.invalid/', 'final_url': 'https://source.invalid/'}, text)
        doc['readingSha256'] = digest_json(doc)
        atomic_write(saved, gzip.compress(json.dumps(doc, ensure_ascii=False).encode()))
        return doc


def source_checks(cite, url, doc):
    checks = []
    def add(rule, state, **kw):
        checks.append({'rule': rule, 'state': state, 'url': url, 'sha256': doc.get('sha256'), **kw})
    exp = citation(cite)
    for match in DATE_RE.finditer(cite):
        if not dates(match.group()):
            add('invalid-calendar-date', 'candidate', cited=match.group())
    for value in exp['isbns']:
        digits = re.sub(r'[^\dX]', '', value.upper())
        if len(digits) == 10 and digits[:9].isdigit() and (digits[-1].isdigit() or digits[-1] == 'X'):
            valid = sum((10-i) * (10 if n == 'X' else int(n)) for i, n in enumerate(digits)) % 11 == 0
        elif len(digits) == 13 and digits.isdigit():
            valid = sum(int(n) * (1 if i % 2 == 0 else 3) for i, n in enumerate(digits)) % 10 == 0
        else:
            add('isbn-checksum', 'unable', expected=value, reason='ambiguous ISBN parsing')
            continue
        add('isbn-checksum', 'pass' if valid else 'candidate', expected=value)
    headers = normal(' '.join(doc['headers']))
    title = exp['title']
    add('citation-title-truncation', 'observation' if title and ('…' in title or '...' in title) else 'not_applicable')
    if title and '…' not in title and '...' not in title:
        # Title identity allows punctuation variations, but words and years survive.
        letters = lambda s: ' '.join(re.sub(r'[^\w]+', ' ', normal(s)).split())
        add('citation-title', 'observation' if letters(title) in letters(headers) else 'unable', expected=title,
            reason='front-matter title signal only; full identity not yet established')
        expected_years = re.findall(r'\b(?:19|20)\d{2}\b', title)
        first_header = next((h for h in doc['headers'] if h.strip()), '')
        observed_years = list(dict.fromkeys(re.findall(r'\b(?:19|20)\d{2}\b', first_header)))
        expected_words = re.sub(r'\b(?:19|20)\d{2}\b', '', letters(title)).split()
        observed_words = re.sub(r'\b(?:19|20)\d{2}\b', '', letters(first_header)).split()
        if len(expected_years) == len(observed_years) == 1 and expected_years != observed_years and len(expected_words) >= 4:
            overlap = len(set(expected_words) & set(observed_words)) / len(set(expected_words))
            if overlap >= .9:
                add('document-edition-year', 'candidate', citedTitle=title, observedHeader=first_header[:1000],
                    expectedYears=expected_years, observedYears=observed_years,
                    reason='similar title with incompatible year; document identity still needs inspection')
    else:
        add('citation-title', 'unable', reason='title ambiguous, missing or truncated')
    publisher = exp['publisher']
    add('citation-publisher', 'observation' if publisher and normal(publisher) in headers else 'unable', expected=publisher,
        reason='publisher name observation only; aliases and mirrors not authenticated')
    date_set = sorted(set(doc['dates']))
    if len(exp['publicationDates']) == len(date_set) == 1:
        add('publication-date', 'observation' if exp['publicationDates'] == date_set else 'candidate',
            cited=exp['publicationDates'], metadata=date_set, reason='metadata can differ from public release date')
    else:
        add('publication-date', 'unable', reason='publication date absent or ambiguous')
    if len(exp['publicationDates']) == len(exp['accessDates']) == 1:
        add('access-before-publication', 'candidate' if exp['accessDates'][0] < exp['publicationDates'][0] else 'pass',
            cited=exp['publicationDates'][0], accessed=exp['accessDates'][0])
    for field, rule in [('dois', 'doi'), ('isbns', 'isbn'), ('cases', 'case-identifier')]:
        for identifier in exp[field]:
            add(rule, 'observation' if normal(identifier) in headers else 'unable', expected=identifier,
                reason='identifier front-matter occurrence only; absence does not prove wrong document')
        regex = {'dois': DOI, 'isbns': ISBN, 'cases': CASE}[field]
        front = ' '.join(doc['headers'])[:8000]
        observed = list(dict.fromkeys(doi_values(front) if field == 'dois' else regex.findall(front)))
        def identity(value):
            value = normal(value)
            return re.sub(r'(\bukut\s+)0+(?=\d)', r'\1', value) if field == 'cases' else value
        if len(exp[field]) == len(observed) == 1 and identity(exp[field][0]) != identity(observed[0]):
            add('identifier-conflict', 'candidate', identifierType=field, cited=exp[field][0], observed=observed[0],
                reason='incompatible unique identifier in front matter; not a confirmed citation error')
    fragment = unquote(urlsplit(url).fragment)
    if fragment.startswith('page=') and doc['kind'] == 'pdf':
        values = parse_qs(fragment).get('page', [])
        if values and values[0].isdigit():
            page = int(values[0])
            add('source-physical-page', 'pass' if 1 <= page <= doc['physicalPages'] else 'candidate',
                expected=page, physicalPages=doc['physicalPages'])
    elif ':~:text=' in fragment:
        parts = fragment.split(':~:text=', 1)[1].split(',')
        add('source-text-fragment', 'observation' if all(normal(p) in doc['norm'] for p in parts if p) else 'unable',
            reason='text-fragment observation; prefix/suffix syntax may need interpretation')
    elif fragment and doc['kind'] == 'html':
        add('source-html-fragment', 'pass' if fragment in doc['anchors'] else 'unable', expected=fragment,
            reason='absent static ID may be generated dynamically')
    for start, end in exp['pages']:
        if not doc['pageLabels']:
            add('source-printed-page', 'unable', expected=[start, end], reason='no declared printed-page mapping; do not infer from physical count')
        else:
            wanted = [start, end] if end else [start]
            found = [physical for physical, label in doc['pageLabels'].items() if label in wanted]
            add('source-printed-page', 'observation' if found else 'unable', expected=wanted, physicalPages=found,
                unlabelledPhysicalPages=doc.get('labelGaps', [])[:100],
                reason='declared label presence, not proof of printed footer or passage identity')
    for paragraph in exp['paragraphs']:
        add('source-paragraph', 'observation' if re.search(r'(?<![\w.])' + re.escape(paragraph) + r'[.)]?\s', doc['norm']) else 'unable',
            expected=paragraph, reason='number occurrence only; may be table of contents or another section')
    add('source-pinpoint-present', 'observation' if exp['pages'] or exp['paragraphs'] or fragment else 'not_applicable',
        expected={'pages': exp['pages'], 'paragraphs': exp['paragraphs'], 'fragment': fragment})
    return checks


def editorial_citations(raw_text, footnotes):
    insertions = []
    for match in re.finditer(r'\(([^()]*)\[footnote\s+(\d+)\]\)', raw_text, re.I):
        content = normal(match[1])
        urls = sorted({l.get('url') for f in footnotes if f.get('id') == 'fn:' + match[2] for l in f.get('links', []) if l.get('url')})
        insertions.append({'text': '(' + content + ')', 'supportingUrls': urls})
    return insertions


def quotation_checks(text, doc, url, raw_text=None, footnotes=()):
    checks = []
    for quote in quotations(text):
        match = locate(doc['comparisonNorm'] if doc.get('inlineRecoveries') else doc['norm'], quote)
        adjusted = False
        if match['state'] != 'pass' and doc.get('comparisonNorm'):
            derived = locate(doc['comparisonNorm'], quote)
            if derived['state'] == 'pass':
                match, adjusted = derived, True
        base = {'url': url, 'sha256': doc['sha256'], 'quoted': quote, 'extractionSha256': doc['extractionSha256']}
        if doc.get('inlineRecoveries'):
            checks.append({'rule': 'source-extraction-recovery', 'state': 'observation', **base,
                           'recoveries': doc['inlineRecoveries'],
                           'reason': 'comparison restores uniquely anchored original HTML glossary labels; no source validity or contextual approval'})
        is_ellipsis = '…' in quote or '...' in quote
        checks.append({'rule': 'quotation-ellipsis' if is_ellipsis else 'quotation-exact', **base, **match,
                       'identityEstablished': False, 'normalisation': 'case, whitespace, typographic quotes; words and signs preserved'})
        if adjusted:
            checks.append({'rule': 'source-furniture', 'state': 'observation', **base,
                           'reason': 'raw text differs only after structurally evidenced furniture exclusions; context unassessed',
                           'adjustments': doc['furniture'][:30]})
        if match['state'] == 'pass':
            if match['occurrencesOfFirstSegment'] > 1:
                checks.append({'rule': 'quotation-repetition', 'state': 'observation', **base,
                               'locations': match['occurrencesOfFirstSegment'], 'reason': 'pinpoint/context ambiguity remains'})
            if match.get('gaps'):
                checks.append({'rule': 'changed-qualifier', 'state': 'candidate' if any(QUALIFIER.search(g) or NEGATION.search(g) for g in match['gaps']) else 'observation',
                               **base, 'omittedText': match['gaps'], 'reason': 'possible qualifier/negation in omission; materiality unassessed'})
            if doc['kind'] == 'pdf':
                second_text = doc.get('secondComparison', doc['second'])
                second = locate(second_text, quote) if second_text is not None else {'state': 'unable'}
                checks.append({'rule': 'quotation-independent-reader', 'state': 'pass' if second['state'] == 'pass' else 'unable', **base,
                               'reason': 'independent reader agrees' if second['state'] == 'pass' else 'independent agreement unavailable; no confirmed PDF finding'})
            if NUMBER.search(quote):
                checks.append({'rule': 'figure-context', 'state': 'pass', **base,
                               'reason': 'figures within located quotation; source validity/context remains unassessed'})
        else:
            near = near_quote(doc.get('comparisonNorm', doc['norm']), quote)
            if near:
                q_values, s_values = quantity_texts(normal(quote), near['excerpt'])
                copied_markers = []
                for item in doc.get('furniture', []):
                    if 'marker' not in item or not item.get('after'):
                        continue
                    preceding = item.get('before', '').split()
                    if not preceding:
                        continue
                    before = preceding[-1]
                    after = ' '.join(item['after'].split()[:3])
                    if len(after.split()) < 3 or not re.search(r'[a-z]{3}', before):
                        continue
                    marker = {'marker': item['marker'], 'before': before, 'after': after}
                    q_values, removed = remove_notes(q_values, [marker])
                    copied_markers += removed
                if copied_markers:
                    near['changed']['number'] = number_values(q_values) != number_values(s_values)
                    checks.append({'rule': 'source-furniture', 'state': 'observation', **base,
                                   'adjustments': copied_markers, 'reason': 'structurally evidenced source reference also copied into quote; wording/context unassessed'})
                if marker_shaped_difference(near):
                    checks.append({'rule': 'source-furniture', 'state': 'unable', **base, **near,
                                   'reason': 'difference has an unproven source-marker shape; no number-error finding or match approval'})
                    continue
                q_units, s_units = numerical_units(q_values), numerical_units(s_values)
                percent = ('%', '')
                if near['changed']['unit'] and q_units.count(percent) != s_units.count(percent) and [u for u in q_units if u != percent] == [u for u in s_units if u != percent]:
                    near['changed']['unit'] = False
                    checks.append({'rule': 'quotation-unit-scope', 'state': 'unable', **base,
                                   'reason': 'percent sign missing in one aligned passage; numerical digits unchanged only if separately established, contextual scale unresolved'})
                second_text = doc.get('secondComparison', doc['second'])
                second_exact = doc['kind'] == 'pdf' and second_text is not None and locate(second_text, quote)['state'] == 'pass'
                omitted = [a for a in re.findall(r'\((?:e-?mail|personal communication|interview)[^()]*\b(?:19|20)\d{2}\)', near['excerpt'], re.I) if a not in normal(quote)]
                if omitted:
                    for attribution in omitted:
                        s_values = s_values.replace(attribution, '')
                    near['changed']['number'] = number_values(q_values) != number_values(s_values)
                    checks.append({'rule': 'quotation-attribution', 'state': 'unable', **base,
                                   'omittedAttributions': omitted, 'reason': 'attribution omission, not a numerical proposition; significance unassessed'})
                additions = []
                if raw_text:
                    for insertion in editorial_citations(raw_text, footnotes):
                        content = insertion['text'][1:-1]
                        if any(u != url for u in insertion['supportingUrls']) and re.fullmatch(r'[\d., ]+\s*(?:gbp|usd|eur|£|\$|€)', content, re.I) and insertion['text'] in normal(quote) and insertion['text'] not in near['excerpt']:
                            additions.append(insertion)
                    if additions:
                        for insertion in additions:
                            q_values = q_values.replace(insertion['text'], '')
                        near['changed']['number'] = number_values(q_values) != number_values(s_values)
                        near['changed']['unit'] = numerical_units(q_values) != numerical_units(s_values)
                        checks.append({'rule': 'editorial-insertion', 'state': 'unable', **base, 'insertions': additions,
                                       'reason': 'separately footnoted conversion; amount and conversion basis have not been verified'})
                typography_only = (near['formatEquivalent'] or re.findall(r'\w+', normal(quote)) == re.findall(r'\w+', near['excerpt'])) and not any(near['changed'].values())
                second_near = near_quote(second_text, quote) if doc['kind'] == 'pdf' and second_text is not None and not second_exact else None
                independent = doc['kind'] != 'pdf' or bool(second_near and second_near['differences'] == near['differences'])
                state = 'observation' if typography_only else 'candidate' if independent and not second_exact else 'unable'
                checks.append({'rule': 'quotation-near-match', 'state': state, **base, **near,
                               'reason': 'formatting-only difference; literal wording and context remain separate' if typography_only else 'independent reader has quoted text: extraction artefact' if second_exact else 'similar text; independent/context/identity validation remains required'})
                if near['numberFormatOnly']:
                    checks.append({'rule': 'quotation-number-format', 'state': 'observation' if independent else 'unable', **base,
                                   'reason': 'derived numeral-format comparison only; no literal match or contextual approval', 'differences': near['differences']})
                if doc['kind'] == 'pdf':
                    checks.append({'rule': 'near-match-independent-reader', 'state': 'observation' if independent else 'unable', **base,
                                   'agreedDifferences': second_near['differences'] if independent and second_near else [],
                                   'reason': 'two readers agree on aligned differences' if independent else 'no independent agreement; do not treat as a citation error'})
                if not second_exact and independent and not typography_only:
                    for kind, changed in near['changed'].items():
                        if changed:
                            checks.append({'rule': 'changed-' + kind, 'state': 'candidate', **base,
                                           'evidence': near, 'reason': 'aligned-text difference needs source/context inspection'})
        if '[' in quote:
            checks.append({'rule': 'editorial-insertion', 'state': 'observation', **base,
                           'insertions': re.findall(r'\[([^]]+)\]', quote), 'reason': 'editorial insertions require separate checking'})
    return checks


def screen(payload, reader):
    claim, footnotes = payload['claim'], payload['footnotes']
    text = claim_text(claim)
    checks = arithmetic(text)
    add = lambda rule, state, **kw: checks.append({'rule': rule, 'state': state, **kw})
    for link in payload['links']:
        if link.get('boundary_uncertain'):
            add('source-url-boundary', 'candidate', url=link['url'], href=link.get('href'))
    for source in payload['sources']:
        url, record = source['url'], source['record']
        original_fragments = sorted({unquote(urlsplit(l.get('href', '')).fragment)
                                     for l in payload['links'] if l.get('url') == url and urlsplit(l.get('href', '')).fragment})
        add('source-retrieval', 'observation' if record.get('status') == 'downloaded' else 'unable',
            url=url, outcome=record.get('status', 'pending'), reason='availability, not claim correctness')
        if record.get('final_url') and record['final_url'] != url:
            add('source-redirect', 'observation', url=url, finalUrl=record['final_url'])
        bib = payload['bibliography'].get(url, [])
        add('bibliography-link', 'observation' if bib else 'unable', url=url,
            reason='URL attribution only; missing entry may have another URL or nested publisher heading')
        if record.get('status') != 'downloaded' or not record.get('sha256'):
            continue
        try:
            doc = reader.read(source['cache'], record['sha256'], tuple(source['rawStat'] or []), tuple(source['textStat'] or []))
        except (OSError, ValueError, html.etree.ParserError) as error:
            add('source-readable', 'unable', url=url, reason='reading failed: ' + type(error).__name__)
            continue
        if doc.get('problem'):
            add('source-integrity', 'unable', url=url, reason=doc['problem'])
            continue
        if source.get('observedExtractionSha256') and source['observedExtractionSha256'] != doc['extractionSha256']:
            add('source-integrity', 'unable', url=url, reason='extraction-changed-since-queue-preparation')
            continue
        add('source-integrity', 'pass', url=url, sha256=record['sha256'])
        quality = source_quality(record, {'kind': doc['kind'], 'status': 'extracted', 'title': doc['headers'][0], 'text': doc['norm']})
        if not quality['readable_source']:
            add('source-readable', 'unable', url=url, reason=quality['reason'])
            continue
        add('source-readable', 'pass', url=url)
        if urlsplit(url).path.casefold().endswith('.pdf'):
            add('source-content-type', 'pass' if doc['kind'] == 'pdf' else 'candidate', url=url, retainedKind=doc['kind'], reason='document-type signal only; landing pages may be intentional')
        add('source-scan-limit', 'unable' if doc['bounded'] else 'pass', url=url, reason='text over scan bound' if doc['bounded'] else 'within scan bound')
        citations = [f['text'] for f in footnotes if any(l.get('url') == url for l in f['links'])]
        if payload.get('bibliographyEntry') and not citations:
            citations = [text]
        if not citations:
            add('citation-title', 'unable', url=url, reason='direct link without parsed bibliographic citation')
        for cite in citations:
            checks.extend(source_checks(cite, url, doc))
            cp_dates = citation(cite)['publicationDates']
            bdates = [citation(b)['publicationDates'] for b in bib]
            if len(cp_dates) == 1 and bdates:
                eligible = [b for b in bdates if len(b) == 1]
                add('bibliography-date', 'observation' if cp_dates in eligible else 'candidate' if eligible else 'unable',
                    url=url, footnoteDates=cp_dates, bibliographyDates=eligible, reason='same URL does not prove unchanged version')
        for fragment in original_fragments:
            # The collector deliberately drops fragments from fetch identities;
            # resolve them from the retained original href, not the fetch URL.
            fragment_rules = {'source-html-fragment', 'source-text-fragment', 'source-physical-page', 'source-pinpoint-present'}
            checks.extend(c for c in source_checks('', url + '#' + fragment, doc) if c['rule'] in fragment_rules)
        checks.extend(quotation_checks(text, doc, url, claim['text'], footnotes))
        # Pinpoint quotation comparison is available only with declared PDF labels
        # or an explicit physical #page. Absence elsewhere is never a hard failure.
        page_targets = []
        for fragment in original_fragments:
            if doc['kind'] == 'pdf' and fragment.startswith('page='):
                page_targets += [int(p) for p in parse_qs(fragment).get('page', []) if p.isdigit()]
        for cite in citations:
            for start, end in citation(cite)['pages']:
                wanted = {start}
                if end and int(start) <= int(end) <= int(start) + 50:
                    wanted = {str(p) for p in range(int(start), int(end) + 1)}
                page_targets += [int(p) for p, label in doc['pageLabels'].items() if label in wanted]
        if page_targets:
            target_text = normal(' '.join(p['text'] for p in doc['pages'] if p['physicalPage'] in page_targets))
            for quote in quotations(text):
                add('quotation-pinpoint', 'observation' if locate(target_text, quote)['state'] == 'pass' else 'unable',
                    url=url, quoted=quote, physicalPages=sorted(set(page_targets)), reason='declared target text only; ranges and neighbouring pages may need checking')
    if payload['tableLike']:
        add('table-scope', 'unable', reason='table/cell representation needs structured mapping; no blanket numerical approval')
    if CASE.search(text) or re.search(r'\b(?:legislation|statute|section \d+|article \d+|judgment|tribunal)\b', text, re.I):
        add('legal-scope', 'unable', reason='legal applicability/interpretation outside mechanical screening')
    add('contextual-support', 'unable', reason='no semantic or human assessment performed')
    for rule in RULES:
        if rule not in OCCURRENCE_RULES and not any(c['rule'] == rule for c in checks):
            add(rule, 'not_applicable', reason='no eligible input for this rule')
    return {'checks': checks, 'assessment': None, 'publicFlag': None,
            'state': 'candidates-for-inspection' if any(c['state'] == 'candidate' for c in checks) else 'screened-with-explicit-gaps'}


def occurrence_checks(payload):
    """Edition/date dependent observations cannot be shared across editions."""
    checks = []
    for ref in dict.fromkeys(payload['claim'].get('footnotes', [])):
        count = payload.get('referenceCounts', {}).get(ref, sum(f['id'] == ref for f in payload['footnotes']))
        checks.append({'rule': 'reference-target', 'state': 'pass' if count else 'candidate', 'reference': ref,
                       'reason': 'retained index mapping; raw-body validation still needed for errors'})
        if count > 1:
            checks.append({'rule': 'duplicate-reference', 'state': 'candidate', 'reference': ref, 'count': count})
        elif payload['claim']['footnotes'].count(ref) > 1:
            checks.append({'rule': 'duplicate-reference', 'state': 'observation', 'reference': ref,
                           'reason': 'same footnote referenced more than once in block; not a duplicate target'})
    published = payload['published'] or ''
    if len(published) >= 10:
        # CPIN title/publication evidence often has month precision. Conservatively
        # compare against the month end rather than inventing day-level precision.
        import calendar
        try:
            y, m = int(published[:4]), int(published[5:7])
            cutoff = date(y, m, calendar.monthrange(y, m)[1]).isoformat()
        except ValueError:
            cutoff = None
        for f in payload['footnotes']:
            for cited in citation(f['text'])['publicationDates']:
                if cutoff and cited > cutoff:
                    checks.append({'rule': 'source-future-date', 'state': 'candidate', 'cited': cited, 'cpinDate': cutoff,
                                   'reason': 'source citation later than CPIN publication month; silent edits/date evidence require verification'})
    for s in payload['sources']:
        checks.append({'rule': 'capture-applicability', 'state': 'unable', 'url': s['url'],
                       'capturedAt': s['record'].get('fetched_at'), 'reason': 'present capture does not establish historical source version'})
    for url, ds in payload['citationDateConflicts'].items():
        checks.append({'rule': 'duplicate-url-citation-date', 'state': 'candidate', 'url': url, 'dates': ds,
                       'reason': 'same URL cited with different dates within edition; version/metadata ambiguity remains'})
    for rule in OCCURRENCE_RULES:
        if not any(c['rule'] == rule for c in checks):
            checks.append({'rule': rule, 'state': 'not_applicable', 'reason': 'no eligible input for this rule'})
    return checks
