"""The web version of a note against its PDF (webpdf.py): what counts as a real difference, and of what kind.

Every case is made on the spot: a small note as GOV.UK would give it, the extraction of its PDF, and the PDF's
raw text. No real note is used and nothing is fetched. The rule under test throughout: a difference is real
only when the PDF's raw text confirms it (docs/methods/pdf-and-web.md, rule 1).
"""
import json

import pymupdf

from cpin import pdftext, webpdf

NOTE = [
    ("h2", "Executive summary"),
    ("p", "The state is generally willing and able to offer effective protection to people who fear non-state actors."),
    ("p", "Internal relocation may be reasonable in large urban areas although the ability of single women to live alone is limited."),
    ("h2", "Assessment"),
    ("p", "3.1.1 A person who is openly critical of the government is likely to be at real risk of serious harm."),
    ("p", "3.1.2 Family members of prominent activists have been questioned, dismissed from their jobs and prevented from travelling abroad."),
    ("h2", "Country information"),
    ("p", "7.1.1 The constitution provides for freedom of expression but the authorities restricted it in practice during the reporting year."),
    ("p", "7.1.2 Journalists reported harassment, arbitrary detention and the confiscation of equipment by officers of the security services."),
    ("p", "7.1.3 Several sources described conditions in pre-trial detention as overcrowded, with limited access to lawyers and doctors."),
]


def body(blocks) -> str:
    return '<div class="govspeak">' + "\n".join(f"<{tag}>{text}</{tag}>" if tag[0] != "<" else tag for tag, text in blocks) + "</div>"


def page(blocks) -> str:
    return "\n".join(text for tag, text in blocks if tag[0] != "<")


def changed(blocks, at: str, new: str, tag: str = "p"):
    """The note with the block that starts with `at` replaced."""
    assert any(text.startswith(at) for _, text in blocks)
    return [(tag, new) if text.startswith(at) else (t, text) for t, text in blocks]


def after(blocks, at: str, *more):
    """The note with blocks added after the one that starts with `at`."""
    out = []
    for tag, text in blocks:
        out.append((tag, text))
        if text.startswith(at):
            out.extend(more)
    return out


def run(web, extraction, raw=None) -> dict:
    return webpdf.compare(body(web), body(extraction), [page(raw if raw is not None else extraction)])


def real(result: dict) -> list[dict]:
    return [d for d in result["differences"] if d["verdict"] == "real"]


def test_the_same_note_twice_has_no_differences():
    result = run(NOTE, NOTE)
    assert result["method"] == webpdf.METHOD
    assert result["differences"] == [] and result["ours"] == []
    assert result["summary"]["wording"]["share"] == 0
    assert result["words"]["web"] == result["words"]["pdf"] > 100


def test_a_sentence_the_web_lacks_is_a_real_difference_of_wording():
    full = "3.1.1 A person who is openly critical of the government is likely to be at real risk of serious harm. This will depend on their profile and activities."
    result = run(NOTE, changed(NOTE, "3.1.1", full))
    (d,) = real(result)
    assert (d["kind"], d["group"], d["size"]) == ("text", "wording", "passage")
    assert d["web"] == "" and d["pdf"].startswith("This will depend on their profile")
    assert (d["web_words"], d["pdf_words"]) == (0, 8)
    assert d["where"]["page"] == 1 and d["where"]["section"] == "Assessment" and d["opening_passage"]
    wording = result["summary"]["wording"]
    assert (wording["web_words"], wording["pdf_words"], wording["passages"]) == (0, 8, 1)
    assert 0 < wording["share"] < 0.1
    assert result["summary"]["opening"]["passages"] == 1


def test_text_the_extraction_dropped_but_the_raw_pdf_has_is_ours_and_not_counted():
    dropped = changed(NOTE, "7.1.2", "7.1.2 Journalists reported harassment by officers of the security services.")
    result = run(NOTE, dropped, raw=NOTE)                     # the PDF's own text has the full sentence
    assert real(result) == []
    assert result["summary"]["wording"]["share"] == 0
    assert result["summary"]["ours"]["differences"] == 1 and result["summary"]["ours"]["web_words"] == 7
    assert result["ours"][0]["verdict"] == "artefact" and "arbitrary detention" in result["ours"][0]["web"]


def test_a_difference_the_raw_text_does_not_confirm_either_way_is_left_unresolved():
    web = changed(NOTE, "7.1.3", "7.1.3 Several sources described conditions in pre-trial detention as severely overcrowded, with limited access to lawyers and doctors.")
    extraction = changed(NOTE, "7.1.3", "7.1.3 Several sources described conditions in pre-trial detention as badly overcrowded, with limited access to lawyers and doctors.")
    result = run(web, extraction, raw=NOTE)                   # the raw text has neither word
    assert real(result) == [] and result["summary"]["unresolved"]["differences"] == 1


TABLE = [["Region", "Events in 2024", "Events in 2025"], ["North Darfur", "238", "872"], ["Blue Nile", "3", "125"], ["Red Sea", "2", "30"]]


def table(rows) -> tuple:
    return ("<table><tbody>" + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows) + "</tbody></table>", "")


def test_a_table_read_in_another_order_is_no_difference():
    web = after(NOTE, "7.1.1", table(TABLE))
    down = [list(column) for column in zip(*TABLE)]            # the extraction reads the table down its columns
    extraction = after(NOTE, "7.1.1", table(down))
    across = after(NOTE, "7.1.1", *[("p", " ".join(row)) for row in TABLE])
    assert real(run(web, extraction, raw=across)) == []        # the raw text has the rows as the web does
    one_cell_a_line = after(NOTE, "7.1.1", *[("p", cell) for column in down for cell in column])
    result = run(web, extraction, raw=one_cell_a_line)         # the raw text comes cell by cell, down the columns
    assert real(result) == [] and result["summary"]["wording"]["share"] == 0
    assert result["summary"]["tables"] == {"web": 1, "pdf": 1}


def test_a_row_missing_from_the_web_table_is_real():
    web = after(NOTE, "7.1.1", table([r for r in TABLE if r[0] != "North Darfur"]))
    extraction = after(NOTE, "7.1.1", table(TABLE))
    raw = after(NOTE, "7.1.1", *[("p", " ".join(row)) for row in TABLE])
    (d,) = real(run(web, extraction, raw=raw))
    assert d["web"] == "" and "North Darfur" in d["pdf"] and d["pdf_words"] == 4


BOX = ("<div class=\"call-to-action\"><p>Official – sensitive: Not for disclosure – Start of section</p>"
       "{}<p>Official – sensitive: Not for disclosure – End of section</p></div>", "")
NOTICE = "The information in this section has been removed as it is restricted for internal Home Office use."


def test_the_notice_on_a_withheld_section_repeated_in_the_pdf_is_its_own_kind():
    web = after(NOTE, "3.1.2", (BOX[0].format(f"<p>{NOTICE}</p>"), ""))
    numbered = "".join(f"<p>3.1.{n} {NOTICE}</p>" for n in (3, 4, 5))
    extraction = after(NOTE, "3.1.2", (BOX[0].format(numbered), ""))
    raw = after(NOTE, "3.1.2", ("p", "Official – sensitive: Not for disclosure – Start of section"),
                *[("p", f"3.1.{n} {NOTICE}") for n in (3, 4, 5)], ("p", "Official – sensitive: Not for disclosure – End of section"))
    result = run(web, extraction, raw=raw)
    assert real(result) and {d["group"] for d in real(result)} <= {"withheld", "numbering"}
    assert result["summary"]["wording"]["share"] == 0
    assert result["summary"]["groups"]["withheld"]["pdf_words"] >= 2 * len(webpdf.words(NOTICE))
    assert result["summary"]["boxes"] == {"web": 1, "pdf": 1, "web_notices": 1, "pdf_notices": 3}


def test_words_the_web_adds_for_a_picture_are_picture_related():
    lead = ("p", "7.1.4 The source published the map below showing the areas of majority Kurdish settlement:")
    described = ("p", "The map shows Kurdish settlements centred on south eastern Turkey, northern Syria and Iraq and western Iran.")
    web = after(NOTE, "7.1.3", lead, described)
    extraction = after(NOTE, "7.1.3", lead, ('<figure class="image embedded"><div class="img"><img src="pdf-image:abc.png" alt=""></div></figure>', ""))
    result = run(web, extraction, raw=after(NOTE, "7.1.3", lead))
    (d,) = real(result)
    assert (d["kind"], d["group"]) == ("picture in words", "picture") and d["web_words"] == 17
    assert result["summary"]["wording"]["share"] == 0
    assert result["summary"]["pictures"] == {"web": 0, "pdf": 1}


def test_a_paragraph_numbered_differently_is_numbering_not_wording():
    renumbered = changed(NOTE, "7.1.3", "7.1.4 Several sources described conditions in pre-trial detention as overcrowded, with limited access to lawyers and doctors.")
    result = run(NOTE, renumbered)
    (d,) = real(result)
    assert (d["kind"], d["group"], d["web"], d["pdf"]) == ("numbering", "numbering", "7.1.3", "7.1.4"), "the whole number is shown, not the digit that differs"
    assert d["where"]["paragraph"] == "7.1.3"
    assert result["summary"]["wording"]["share"] == 0 and result["summary"]["groups"]["numbering"]["differences"] == 1
    unnumbered = changed(NOTE, "7.1.3", "Several sources described conditions in pre-trial detention as overcrowded, with limited access to lawyers and doctors.")
    (d,) = real(run(unnumbered, NOTE))                         # numbered in the PDF, not on the web
    assert (d["kind"], d["web"], d["pdf"]) == ("numbering", "", "7.1.3")


def test_an_address_with_line_breaks_is_no_difference():
    web = after(NOTE, "7.1.3", ('<div class="address"><div class="adr org fn"><p>\nIndependent Advisory Group on Country Information<br>'
                                '3rd Floor<br>28 Kirby Street<br>London<br>EC1N 8TE\n</p></div></div>', ""))
    lines = [("p", "Independent Advisory Group on Country Information"), ("p", "3rd Floor"), ("p", "28 Kirby Street"), ("p", "London"), ("p", "EC1N 8TE")]
    result = run(web, after(NOTE, "7.1.3", *lines))
    assert result["differences"] == [] and result["ours"] == []
    assert result["words"]["web"] == result["words"]["pdf"]


def test_a_passage_repeated_on_the_web_is_real_and_only_on_the_web():
    twice = after(NOTE, "3.1.2", NOTE[4], NOTE[5])              # paragraphs 3.1.1 and 3.1.2 printed a second time
    result = run(twice, NOTE)
    (d,) = real(result)
    assert (d["kind"], d["size"], d["pdf"]) == ("text", "passage", "") and d["web"].startswith("3.1.1 A person who is openly critical")
    repeated = len(webpdf.words(NOTE[4][1] + " " + NOTE[5][1]))
    assert d["web_words"] == repeated and result["summary"]["wording"]["web_words"] == repeated
    assert result["summary"]["wording"]["pdf_words"] == 0


def test_typography_is_not_a_difference():
    web = changed(NOTE, "7.1.1", "7.1.1 The constitution provides for ‘freedom of expression’ – but the authorities restricted it in practice during the reporting year…")
    pdf = changed(NOTE, "7.1.1", "7.1.1 The constitution provides for 'freedom of expression' - but the authorities restricted it in practice during the reporting year...")
    assert run(web, pdf)["differences"] == []


def test_a_footnote_mark_the_extraction_read_as_a_word_is_ours():
    mark = '<sup id="fnref:7"><a href="#fn:7" class="footnote" rel="footnote" role="doc-noteref">[footnote 7]</a></sup>'
    web = changed(NOTE, "7.1.2", "7.1.2 Journalists reported harassment, arbitrary detention" + mark + " and the confiscation of equipment by officers of the security services.")
    glued = changed(NOTE, "7.1.2", "7.1.2 Journalists reported harassment, arbitrary detention7 and the confiscation of equipment by officers of the security services.")
    result = run(web, glued)
    assert real(result) == [] and result["summary"]["ours"]["differences"] == 1


def test_signs_of_different_drafts_and_what_is_counted():
    dated = lambda day: after(NOTE, "Assessment", ("p", f"Section updated: {day}"))
    result = run(dated("19 September 2023"), dated("19 September 2024"))
    assert result["summary"]["section_updated"] == {"web": ["19 September 2023"], "pdf": ["19 September 2024"], "same": False}
    assert any("'Section updated' date differs" in sign for sign in result["summary"]["drafts"])
    assert run(dated("5 November 2025"), dated("05 November 2025"))["summary"]["section_updated"]["same"]
    top = lambda line: [("p", line)] + NOTE
    result = webpdf.compare(body(top("Version 3.0, February 2025")), body(top("Version 3.0, February 2025")),
                            ["Country Policy and Information Note\nVersion 3.0\nFebruary 2025", page(NOTE)])
    assert result["summary"]["version"] == {"web": "3.0", "web_date": "February 2025", "pdf": "3.0", "pdf_date": "February 2025"}
    assert result["summary"]["drafts"] == [] and real(result) == []


def _pdf(path, paragraphs, mark_after=None):
    """A two-page PDF: a cover, then the paragraphs in 12-point type, one of them with a raised footnote mark."""
    doc = pymupdf.open()
    cover = doc.new_page()
    cover.insert_text((72, 200), "Country Policy and Information Note", fontsize=26)
    cover.insert_text((72, 300), "Version 2.0", fontsize=12)
    cover.insert_text((72, 320), "July 2026", fontsize=12)
    page_ = doc.new_page()
    y = 96
    for text in paragraphs:
        for k, line in enumerate(_wrap(text)):
            page_.insert_text((72, y), line, fontsize=12)
            if mark_after and line.endswith(mark_after):
                page_.insert_text((72 + pymupdf.get_text_length(line, fontsize=12) + 0.5, y - 4), "1", fontsize=8)
            y += 15
        y += 9
    page_.insert_text((275, 806), "Page 2 of 2", fontsize=8)
    doc.save(path)
    doc.close()
    return path


def _wrap(text: str, width: int = 78) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    return lines + [line]


PARAGRAPHS = [text for tag, text in NOTE if tag == "p"]


def test_read_pdf_takes_raised_numbers_and_page_furniture_out_of_the_readings(tmp_path):
    raw = webpdf.read_pdf(_pdf(tmp_path / "note.pdf", PARAGRAPHS, mark_after="serious harm."))
    assert len(raw["pages"]) == 2 and raw["pages"][1]["lines"] and "Page 2 of 2" in raw["pages"][1]["text"]
    readings = webpdf._readings(raw)
    assert " serious harm 3 1 2 family members " in readings["nomark"]          # the mark "1" is gone
    assert " serious harm 1 " in readings["plain"]                              # as the PDF has it
    assert "page 2 of 2" not in readings["flow"] and "page 2 of 2" in readings["nomark"]


def test_the_store_keeps_one_record_per_pair_and_does_not_redo_an_unchanged_one(store, tmp_path):
    path = _pdf(tmp_path / "note.pdf", PARAGRAPHS + ["This closing paragraph is in the PDF and not in the web version of the note."])
    web = body([("p", "Version 2.0, July 2026")] + [("p", text) for text in PARAGRAPHS])
    job = ("kenya/a-note", str(path), "f" * 64, web, "b" * 64)
    said = []
    first = webpdf.compare_into_store(store, [job], workers=1, log=said.append)
    assert (first["done"], first["done_before"], first["errors"]) == (1, 0, [])
    kept = json.loads(webpdf.compare_path(store, "f" * 64).read_text("utf-8"))
    assert kept == first["records"][0] == webpdf.load_comparison(store, "f" * 64)
    assert (kept["method"], kept["extractor"], kept["note"]) == (webpdf.METHOD, pdftext.EXTRACTOR, "kenya/a-note")
    assert (kept["pdf_sha256"], kept["body_sha256"]) == ("f" * 64, "b" * 64)
    assert kept["summary"]["wording"]["pdf_words"] == 16 and kept["summary"]["wording"]["web_words"] == 0
    assert kept["differences"][0]["pdf"].startswith("This closing paragraph") and said and "kenya/a-note" in said[0]
    again = webpdf.compare_into_store(store, [job], workers=1)
    assert (again["done"], again["done_before"]) == (0, 1) and again["records"] == first["records"]
    assert webpdf.compare_into_store(store, [job], workers=1, force=True)["done"] == 1
    edited = job[:3] + (web.replace("generally willing", "willing"), "c" * 64)       # GOV.UK edits the page
    assert webpdf.compare_into_store(store, [edited], workers=1)["done"] == 1
    missing = ("kenya/gone", str(tmp_path / "none.pdf"), "e" * 64, web, "b" * 64)
    failed = webpdf.compare_into_store(store, [missing], workers=1)
    assert failed["done"] == 0 and failed["records"] == [] and "error" in failed["errors"][0]


def _record(note: str, web, extraction, raw=None) -> dict:
    return {"note": note, "pdf_sha256": note, "body_sha256": "b", **run(web, extraction, raw)}


def test_the_standard_table_names_the_notes_to_read():
    same = [_record(f"country/same-{n}", NOTE, NOTE) for n in range(8)]
    slip = _record("country/slip", changed(NOTE, "7.1.2", "7.1.2 Journalists reported harassment."), changed(NOTE, "7.1.2", "7.1.2 Journalist reported harassment."))
    cut = _record("country/cut-short", changed(NOTE, "3.1.1", "3.1.1 A person who is openly critical of the government is likely to be"), NOTE)
    numbers = _record("country/renumbered", NOTE, changed(NOTE, "7.1.3", NOTE[9][1].replace("7.1.3", "7.1.4")))
    summary = webpdf.summarise(same + [slip, cut, numbers])
    wording = summary["wording"]
    assert summary["pairs"] == 11 and wording["none"] == 9                      # a renumbered paragraph is not wording
    assert wording["best"]["share"] == 0 and wording["median"]["share"] == 0
    assert wording["worst"]["note"] == "country/cut-short" and wording["worst"]["words"] == 6
    assert (wording["at_half_percent"], wording["at_one_percent"]) == (2, 1)    # in so short a note one word is 0.4%
    assert [n["note"] for n in summary["flagged"]] == ["country/cut-short", "country/slip"]     # worst first
    assert summary["flagged"][0]["opening_passages"] == 1 and summary["flagged"][1]["opening_passages"] == 0
    assert summary["flagged"][0]["largest_in_opening"]["pdf"] == "at real risk of serious harm."
    assert summary["groups"]["numbering"]["notes"] == 1 and summary["groups"]["wording"]["notes"] == 2
    assert summary["groups"]["wording"]["web_words"] == 1 and summary["groups"]["wording"]["pdf_words"] == 7
    lines = webpdf.table(summary)
    assert lines[0].startswith(f"compare ({webpdf.METHOD}): 11 notes") and any("country/cut-short" in line and "PDF only" in line for line in lines)
    assert webpdf.table(webpdf.summarise([]))[0].startswith(f"compare ({webpdf.METHOD}): 0 notes")


def test_the_command_compares_every_live_note_that_has_a_pdf(site, client, store, tmp_path, capsys):
    import argparse

    from conftest import govuk
    from cpin import cli
    from cpin.sync import sync
    pdf_bytes = _pdf(tmp_path / "note.pdf", PARAGRAPHS + ["This closing paragraph is in the PDF and not in the web version of the note."]).read_bytes()
    govuk(site, body=body([("p", "Version 2.0, July 2026")] + [("p", text) for text in PARAGRAPHS]), pdf=pdf_bytes)
    sync(client, store)
    args = argparse.Namespace(country=[], limit=None, force=False, workers=1, report=str(tmp_path / "report.json"), page=str(tmp_path / "differences.html"))
    assert cli.cmd_compare(args, store) == 0
    out = capsys.readouterr().out
    assert f"compare ({webpdf.METHOD}): 1 notes" in out and "1 compared now · 0 already done · 0 failed" in out
    page = (tmp_path / "differences.html").read_text("utf-8")          # the same records, laid out to read through
    assert "Web version and PDF: where they differ" in page and "Kenya" in page and "<script" not in page
    assert "0 / " in out and "This closing paragraph" in out
    report = json.loads((tmp_path / "report.json").read_text("utf-8"))
    assert report["pairs"] == 1 and report["groups"]["wording"]["pdf_words"] == 16
    assert len(list((store.root / "pdfs" / "compare").glob("*.json"))) == 1
    assert cli.cmd_compare(args, store) == 0 and "0 compared now · 1 already done" in capsys.readouterr().out


def test_each_paragraph_numbered_differently_in_the_pdf_is_mapped_for_citations():
    # The PDF numbers two sections 7.1, so everything after is one behind the web version's numbering.
    pdf = changed(changed(NOTE, "7.1.2", "7.1.1 Journalists reported harassment, arbitrary detention and the confiscation of equipment by officers of the security services."),
                  "7.1.3", "Several sources described conditions in pre-trial detention as overcrowded, with limited access to lawyers and doctors.")
    result = webpdf.compare(body(NOTE), body(pdf), [page(pdf)])
    assert result["paragraphs"] == {"same": 3, "different": {"7.1.2": "7.1.1"}, "pdf_unnumbered": ["7.1.3"], "web_unnumbered": 0,
                                    "repeated": [], "unconfirmed": []}
    assert webpdf.compare(body(NOTE), body(NOTE), [page(NOTE)])["paragraphs"] == {
        "same": 5, "different": {}, "pdf_unnumbered": [], "web_unnumbered": 0, "repeated": [], "unconfirmed": []}
    assert webpdf.compare(body(pdf), body(NOTE), [page(NOTE)])["paragraphs"]["web_unnumbered"] == 1, "numbered in the PDF only"


def test_a_number_the_web_version_uses_twice_is_not_mapped_to_one_pdf_number():
    # Iran, Kurds and Kurdish political groups (October 2025): the web version numbers a later section's
    # paragraphs as an earlier section's, so "3.1.1" and "3.1.2" each stand for two paragraphs. The PDF has
    # them as 3.1.1, 3.1.2 and 9.1.1, 9.1.2. A map keyed by the web number gave all four the later pair.
    again = [("h2", "Freedom of movement"),
             ("p", "3.1.1 Citizens are free in law to travel within the country and to leave it, subject to exit permits."),
             ("p", "3.1.2 Checkpoints on the main roads between provinces were reported throughout the year by travellers."),
             ("p", "3.1.3 Women travelling alone were asked for the written consent of a male relative at some airports.")]
    web = NOTE + again
    pdf = NOTE + [(tag, text.replace("3.1.", "9.1.")) for tag, text in again]
    numbers = webpdf.compare(body(web), body(pdf), [page(pdf)])["paragraphs"]
    assert numbers["repeated"] == ["3.1.1", "3.1.2"]
    assert numbers["different"] == {"3.1.3": "9.1.3"}, "a number used once is still mapped"
    assert numbers["same"] == 3 and numbers["pdf_unnumbered"] == []
    # The same when one of the two has no number in the PDF: which of them it is cannot be said by number.
    bare = NOTE + [(tag, text.replace("3.1.1 ", "")) if text.startswith("3.1.1") else (tag, text.replace("3.1.", "9.1.")) for tag, text in again]
    numbers = webpdf.compare(body(web), body(bare), [page(bare)])["paragraphs"]
    assert numbers["repeated"] == ["3.1.1", "3.1.2"] and numbers["pdf_unnumbered"] == []


def test_a_different_pdf_number_is_kept_only_if_a_second_reader_of_the_pdf_has_it_too():
    pdf = changed(NOTE, "7.1.2", "7.1.1 Journalists reported harassment, arbitrary detention and the confiscation of equipment by officers of the security services.")
    alone = webpdf.compare(body(NOTE), body(pdf), [page(pdf)])["paragraphs"]
    assert alone["different"] == {"7.1.2": "7.1.1"} and alone["unconfirmed"] == [], "no second reader: as the first reads it"
    agreed = webpdf.compare(body(NOTE), body(pdf), [page(pdf)], second=[page(pdf)])["paragraphs"]
    assert agreed["different"] == {"7.1.2": "7.1.1"} and agreed["unconfirmed"] == []
    # The second reader has "7.1.2" before those words, as the web does: the number is our misreading, and is not given.
    disputed = webpdf.compare(body(NOTE), body(pdf), [page(pdf)], second=[page(NOTE)])["paragraphs"]
    assert disputed["different"] == {} and disputed["unconfirmed"] == ["7.1.2"] and disputed["same"] == 4
    # A footnote number the second reader sets among the opening words does not hide them.
    marked = page(pdf).replace("7.1.1 Journalists reported", "7.1.1 Journalists12 reported")
    assert webpdf.compare(body(NOTE), body(pdf), [page(pdf)], second=[marked])["paragraphs"]["different"] == {"7.1.2": "7.1.1"}


# --- a second reader of the PDF, and kinds that are not wording ---

def test_a_difference_a_second_reader_of_the_pdf_disputes_is_not_reported_as_real():
    # Our reading of the PDF (extraction and raw text alike) says "facilties"; the web says "faculties".
    ours = changed(NOTE, "7.1.3", "7.1.3 Several sources described conditions in pre-trial detention as overcrowded, with limited access to facilties and doctors.")
    web = changed(NOTE, "7.1.3", "7.1.3 Several sources described conditions in pre-trial detention as overcrowded, with limited access to faculties and doctors.")
    alone = webpdf.compare(body(web), body(ours), [page(ours)])
    (d,) = real(alone)
    assert d["web"] == "faculties" and "second" not in d and alone["summary"]["second"]["reader"] is None

    agreed = webpdf.compare(body(web), body(ours), [page(ours)], second=[page(ours)])        # the second reader sees "facilties" too
    (d,) = real(agreed)
    assert d["second"] == "agrees" and agreed["summary"]["second"] == {"reader": "pdftotext", "agrees": 1, "cannot_tell": 0, "disputes": 0}

    disputed = webpdf.compare(body(web), body(ours), [page(ours)], second=[page(web)])       # it reads the PDF as the web has it
    assert real(disputed) == [] and disputed["summary"]["wording"]["share"] == 0
    assert disputed["summary"]["unresolved"]["differences"] == 1 and disputed["summary"]["second"]["disputes"] == 1


def test_the_second_reader_needs_the_shared_words_on_both_sides_of_words_only_one_version_has():
    web = changed(NOTE, "7.1.2", "7.1.2 Journalists reported harassment and the confiscation of equipment by officers of the security services.")
    result = webpdf.compare(body(web), body(NOTE), [page(NOTE)], second=[page(NOTE)])
    (d,) = real(result)
    assert d["pdf"] == "arbitrary detention" and d["second"] == "agrees", "the PDF has the two words between the words both share"
    # A footnote number the second reader sets inside the run does not hide it.
    marked = page(NOTE).replace("harassment, arbitrary detention", "harassment,12 arbitrary detention")
    assert real(webpdf.compare(body(web), body(NOTE), [page(NOTE)], second=[marked]))[0]["second"] == "agrees"


def test_what_is_not_wording_arabic_letters_a_repeated_label_a_name_for_a_picture_a_broken_anchor():
    # Arabic: a PDF's text layer gives the letters out of order, whoever reads it.
    web = after(NOTE, "7.1.3", ("p", "7.1.4 The law is entitled خلال المدة in the original."))
    pdf = after(NOTE, "7.1.3", ("p", "7.1.4 The law is entitled خالل المدة in the original."))
    (d,) = real(run(web, pdf))
    assert (d["kind"], d["group"]) == ("arabic letters", "form")
    # A label before every entry in the PDF's table, which the web version leaves out.
    def entries(label: bool):
        out = []
        for name in ("Tran Anh", "Le Van", "Pham Thi", "Bui Duc"):
            out.append(("p", f"Name: {name}" if label else name))
            out.append(("p", f"{name} was recorded as a journalist and blogger working in the capital city."))
        return out

    result = run(after(NOTE, "7.1.3", *entries(False)), after(NOTE, "7.1.3", *entries(True)))
    assert {d["kind"] for d in real(result)} == {"repeated label"} and result["summary"]["wording"]["share"] == 0
    # A name where the PDF has the picture, after a lead-in that ends with a colon.
    lead = "7.1.4 The source published the following map of the provinces:"
    web = after(NOTE, "7.1.3", ("p", lead + " Provinces map"))
    pdf = after(NOTE, "7.1.3", ("p", lead), ('<figure class="image embedded"><div class="img"><img src="pdf-image:abc.png" alt=""></div></figure>', ""))
    (d,) = real(run(web, pdf, raw=after(NOTE, "7.1.3", ("p", lead))))
    assert (d["kind"], d["web"]) == ("picture in words", "Provinces map")
    # A broken anchor GOV.UK left in the text.
    web = changed(NOTE, "7.1.2", "7.1.2 {#Organisations_responsible_for} Journalists reported harassment, arbitrary detention and the confiscation of equipment by officers of the security services.")
    (d,) = real(run(web, NOTE))
    assert (d["kind"], d["group"]) == ("stray characters", "form")


def test_pdftotext_reads_a_pdf_page_by_page_when_it_is_installed(tmp_path):
    import shutil

    import pytest
    if not shutil.which("pdftotext"):
        pytest.skip("pdftotext (poppler) is not installed")
    doc = pymupdf.open()
    for text in ("The state is generally willing and able to offer protection.", "Internal relocation may be reasonable."):
        doc.new_page().insert_text((72, 100), text, fontsize=12)
    doc.save(tmp_path / "two.pdf")
    pages = webpdf.read_pdf_second(tmp_path / "two.pdf")
    assert [webpdf.words(p) for p in pages[:2]] == [webpdf.words("The state is generally willing and able to offer protection."), webpdf.words("Internal relocation may be reasonable.")]
    assert webpdf.read_pdf_second(tmp_path / "missing.pdf") is None
