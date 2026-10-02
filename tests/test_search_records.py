import json

from cpin import search_records as sr
from cpin.store import Store, write_json

BODY = """<div class="govspeak">
<div class="application-notice info-notice"><p>Version 2.0, May 2026</p></div>
<h2 id="executive-summary">Executive summary</h2>
<p>Kurds face discrimination.<sup id="fnref:1"><a href="#fn:1" class="footnote" rel="footnote" role="doc-noteref">[footnote 1]</a></sup> Some are detained.</p>
<h2 id="assessment">Assessment</h2>
<h3 id="risk">3. Risk</h3>
<h4 id="kurdish-ethnicity">3.1 Kurdish ethnicity</h4>
<p>3.1.1 Kurds are unlikely to face a real risk<sup><a href="#fn:2" role="doc-noteref">[footnote 2]</a></sup>.</p>
<table><tr><td>Region</td><td>Population</td></tr></table>
<ul><li>first</li><li>second</li></ul>
<h3>5. Internal relocation</h3>
<p>Relocation to Tehran is <strong>not</strong> reasonable.</p>
<h2 id="bibliography">Bibliography</h2>
<h3 id="sources-cited">Sources cited</h3>
<p>Amnesty International, Iran report.</p>
<h2 id="version-control-and-feedback">Version control and feedback</h2>
<p>Version 2.0, valid from 1 May 2026</p>
<div class="footnotes" role="doc-endnotes"><ol><li id="fn:1"><p>USSD, 2025</p></li><li id="fn:2"><p>HRW, 2024</p></li></ol></div>
</div>"""


def test_sections_split_at_h2_h3_and_skip_back_matter():
    secs = sr.sections(BODY)
    assert [(s["anchor"], s["section"], s["level"]) for s in secs] == [
        ("executive-summary", "Executive summary", 2),
        ("risk", "3. Risk", 3),
        ("section-4", "5. Internal relocation", 3),      # no id: numbered as the reader numbers it
    ]
    text = "\n".join(s["content"] for s in secs)
    assert "Version 2.0, May 2026" not in text              # the version notice before the first heading
    assert "Amnesty" not in text and "valid from" not in text and "USSD" not in text


def test_section_text_is_verbatim_without_footnote_markers():
    summary, risk, reloc = sr.sections(BODY)
    assert summary["content"] == "Executive summary\nKurds face discrimination. Some are detained."
    assert "[footnote" not in risk["content"]
    assert "3.1 Kurdish ethnicity\n3.1.1 Kurds are unlikely to face a real risk." in risk["content"]
    assert "Region\nPopulation" in risk["content"]            # table cells and list items stay separate words
    assert "first\nsecond" in risk["content"]
    assert reloc["content"].endswith("Relocation to Tehran is not reasonable.")


def test_text_before_the_first_heading_is_kept_when_it_is_not_just_the_notice():
    secs = sr.sections('<div class="govspeak"><p>Reference: ALB-001</p><h2 id="a">A</h2><p>Body</p></div>')
    assert secs[0] == {"anchor": "", "section": "", "level": 1, "content": "Reference: ALB-001"}
    assert secs[1]["anchor"] == "a"


COUNTRY = {"slug": "iran", "name": "Iran", "iso_a2": "ir"}
NOTE = {"id": "cpin-kurds-iran", "title": "Country policy and information note: Kurds, Iran, May 2026", "kind": "CPIN",
        "topic": "kurds and Kurdish political groups", "month": "2026-05", "status": "live", "version": "2.0"}
INDEX = {"title": NOTE["title"], "status": "live", "current_sha256": "ab" * 32,
         "versions": [{"sha256": "ab" * 32, "title": NOTE["title"], "version_banner": "2.0"}]}


def test_note_records_shape_and_unique_urls():
    body = BODY.replace('<h3>5. Internal relocation</h3>', '<h3 id="risk">5. Internal relocation</h3>')  # a repeated id
    body = body.replace('<h2 id="executive-summary">', '<p>Preamble text</p><h2 id="executive-summary">')
    recs = sr.note_records(COUNTRY, NOTE, INDEX, body)
    title, *texts = recs
    assert title["meta"]["type"] == "title" and title["content"] == NOTE["title"]
    assert title["url"] == "prototypes/reader/index.html?country=iran&note=cpin-kurds-iran"
    assert title["meta"]["title"] == "Kurds and Kurdish political groups"
    assert title["filters"] == {"country": ["Iran"], "kind": ["CPIN"], "type": ["title"]}
    first = texts[0]
    assert first["meta"]["anchor"] == "" and first["url"].endswith("#doc")
    risk = next(r for r in texts if r["meta"]["section"] == "3. Risk")
    assert risk["url"] == "prototypes/reader/index.html?country=iran&note=cpin-kurds-iran#risk"
    assert risk["meta"] == {"title": "Kurds and Kurdish political groups", "country": "Iran", "slug": "iran",
                            "note": "cpin-kurds-iran", "kind": "CPIN", "version": "2.0", "month": "2026-05",
                            "iso_a2": "ir", "section": "3. Risk", "anchor": "risk", "level": "3", "type": "text"}
    assert risk["language"] == "en"
    repeat = texts[-1]
    assert repeat["meta"]["anchor"] == "risk" and "&part=" in repeat["url"]
    assert len({r["url"] for r in recs}) == len(recs)       # Pagefind merges records that share a URL


def test_build_records_reads_live_notes_from_the_store(tmp_path):
    store = Store(tmp_path / "data")
    sha = INDEX["current_sha256"]
    write_json(store.note_dir("iran", NOTE["id"]) / "index.json", INDEX)
    store.body_path("iran", NOTE["id"], sha).write_text(BODY, "utf-8")
    dashboard = {"countries": [{**COUNTRY, "notes": [NOTE, {**NOTE, "id": "gone", "status": "archived"},
                                                     {**NOTE, "id": "pdf", "pdf_only": True}, {**NOTE, "id": "missing"}]}]}
    skipped = []
    recs = list(sr.build_records(store, dashboard, log=skipped.append))
    assert {r["meta"]["note"] for r in recs} == {NOTE["id"]}
    assert len(recs) == 4 and len(skipped) == 1 and "missing" in skipped[0]
    out = tmp_path / "records.jsonl"
    stats = sr.write_records(recs, out)
    assert stats["records"] == 4 and stats["notes"] == 1
    assert [json.loads(line)["meta"]["type"] for line in out.read_text("utf-8").splitlines()] == ["title", "text", "text", "text"]
