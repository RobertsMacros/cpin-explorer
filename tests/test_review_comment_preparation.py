"""Bound the excerpt/locator decisions before held comments enter the whitelist."""
import importlib.util
from pathlib import Path

from lxml import html

spec = importlib.util.spec_from_file_location("review_comments", Path(__file__).resolve().parents[1] / "scripts/prepare_review_comments.py")
comments = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comments)


def test_nested_third_party_quotation_is_excluded_from_licensed_prefix():
    own = "8.1.4. I recommend clarifying the population covered by the source."
    assert comments.excerpt(own + " ‘The source's protected wording’") == own
    assert comments.excerpt("8.1.4. ‘A long protected quotation must not be republished’") == ""


def test_source_introducing_colon_stops_before_unquoted_source_words():
    own = "I suggest adding the following source to improve coverage"
    assert comments.excerpt(own + ": protected source words follow") == own


def test_only_explicit_opening_cpin_locators_create_inline_anchors():
    root = html.fromstring('<div><p>8.1.4 Original paragraph words.</p><p>8.1.5 Second original paragraph.</p></div>')
    assert [a["paragraph"] for a in comments.inline_anchors("8.1.4 and 8.1.5 should be clarified.", root)] == ["8.1.4", "8.1.5"]
    assert comments.inline_anchors("1.11 I discuss paragraph 8.1.4 later in this review.", root) == []
    assert comments.inline_anchors("This source discusses 8.1.4 of another report.", root) == []


def test_repeated_paragraph_numbers_are_not_guessed():
    root = html.fromstring('<div><p>8.1.4 First section.</p><p>8.1.4 Another section.</p></div>')
    assert comments.inline_anchors("8.1.4 should be clarified.", root) == []


def test_truncated_extract_is_labelled_without_changing_retained_words():
    text = "A reviewer recommendation with enough words to explain its limited precise scope"
    assert comments.excerpt(text, 8) == "A reviewer recommendation with enough words to explain …"
