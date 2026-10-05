"""Editions published as a PDF only: their text, laid out like GOV.UK's web version (pdftext.py).

The PDFs here are made on the spot, in the shape of the Home Office's: a cover, a contents page, bookmarks,
numbered paragraphs, a bulleted list, footnotes under a short rule, links, and a paragraph cut by a page end.
"""
import re

import pymupdf
import pytest

from cpin import pdftext

LEFT, TEXT, RIGHT = 72, 114.6, 523


def _note_pdf(path, *, bookmarks=True, cut="Human Rights Practices", preface=False, cover_lines=None):
    doc = pymupdf.open()
    cover = doc.new_page()
    cover.insert_text((LEFT, 200), "Country Policy and Information Note", fontsize=26)
    cover.insert_text((LEFT, 240), "Kenya: Actors of protection", fontsize=25, fontname="hebo")
    for y, line in cover_lines or [(300, "Version 2.0"), (320, "July 2026")]:
        cover.insert_text((LEFT, y), line, fontsize=12)
    if preface:                                   # the older template: a Preface with no bookmark, before the contents
        pre = doc.new_page()
        pre.insert_text((LEFT, 96), "Preface", fontsize=26)
        pre.insert_text((LEFT, 140), "Purpose", fontsize=12, fontname="hebo")
        pre.insert_text((LEFT, 164), "This note provides country of origin information for decision makers.", fontsize=12)
    contents = doc.new_page()
    contents.insert_text((LEFT, 84), "Contents", fontsize=12, fontname="hebo")
    for i, t in enumerate(["Assessment ...................................... 3", "1. Protection ................................... 3",
                           "1.1 The police, the gendarmerie and the wider system of", "law enforcement ................................. 3",
                           "Country information ............................. 4"]):
        contents.insert_text((LEFT, 104 + i * 19), t, fontsize=12)

    def furniture(page, n):
        page.insert_text((275, 806), f"Page {n} of 4", fontsize=8)

    furniture(contents, 2)
    p = doc.new_page()
    furniture(p, 3)
    p.insert_text((LEFT, 96), "Assessment", fontsize=26)
    p.insert_text((LEFT, 140), "1.", fontsize=12, fontname="hebo")
    p.insert_text((TEXT, 140), "Protection", fontsize=12, fontname="hebo")
    p.insert_text((LEFT, 160), "1.1", fontsize=12)
    p.insert_text((TEXT, 160), "The police", fontsize=12)
    p.insert_text((LEFT, 180), "1.1.1", fontsize=12)
    p.insert_text((TEXT, 180), "The state is generally willing and able to offer effective protection", fontsize=12)
    width = lambda text, size=12: pymupdf.get_text_length(text, fontsize=size)
    end = TEXT + width("The state is generally willing and able to offer effective protection")
    p.insert_text((end + 0.5, 176), "1", fontsize=8)                        # the footnote mark, raised
    p.insert_text((end + 6, 180), ". See the", fontsize=12)
    p.insert_text((TEXT, 194), "guidance on credibility for more.", fontsize=12)
    p.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(TEXT, 184, TEXT + width("guidance on credibility"), 197), "uri": "https://www.gov.uk/guidance/credibility"})
    p.insert_text((LEFT, 214), "1.1.2", fontsize=12)
    p.insert_text((TEXT, 214), "Protection may not be available where:", fontsize=12)
    for i, item in enumerate(["the person is a critic of the state", "the police are themselves the actors of persecution"]):
        p.insert_text((TEXT, 234 + i * 20), "•", fontsize=12)
        p.insert_text((TEXT + 18, 234 + i * 20), item, fontsize=12)
    p.insert_text((432, 290), "Back to Contents", fontsize=12)
    # A paragraph that runs over the page: its last line here is full (the next word would not have fitted).
    p.insert_text((LEFT, 320), "1.1.3", fontsize=12)
    line = "The US Department of State noted in its 2025 Country Report on country"
    p.insert_text((TEXT, 320), line, fontsize=12)
    room = RIGHT - TEXT - width(line)
    assert width("It") + 3 < room < width("Human") + 3, "room for a short word, not for a long one"
    p.draw_line((LEFT, 700), (LEFT + 144, 700))
    p.insert_text((LEFT, 712), "1", fontsize=6.5)
    p.insert_text((LEFT + 6, 716), "USSD, Country report, March 2026", fontsize=10)
    p.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(LEFT + 6 + width("USSD, ", 10), 707, LEFT + 6 + width("USSD, Country report", 10), 718), "uri": "https://example.org/report"})
    q = doc.new_page()
    furniture(q, 4)
    q.insert_text((TEXT, 84), f"{cut} that the courts were independent.", fontsize=12)
    q.insert_text((LEFT, 130), "Country information", fontsize=26)
    q.insert_text((LEFT, 170), "2.1.1", fontsize=12)
    q.insert_text((TEXT, 170), "Version control: version 2.0, valid from 14 July 2026.", fontsize=12)
    if bookmarks:
        at = 1 if preface else 0
        doc.set_toc([[1, "Assessment", 3 + at], [2, "1. Protection", 3 + at], [3, "1.1 The police", 3 + at], [1, "Country information", 4 + at]])
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def note_pdf(tmp_path):
    return _note_pdf(tmp_path / "note.pdf")


def test_a_pdf_note_comes_out_shaped_like_the_web_version(note_pdf):
    result = pdftext.pdf_to_html(note_pdf)
    html = result.html
    assert html.startswith('<div class="govspeak"><p>Version 2.0, July 2026</p>'), "the cover's version line opens the text"
    assert re.findall(r"<(h[2-4]) id=\"([^\"]+)\">([^<]+)</h", html) == [
        ("h2", "assessment", "Assessment"), ("h3", "protection", "1. Protection"), ("h4", "the-police", "1.1 The police"),
        ("h2", "country-information", "Country information")], "bookmarks become h2, h3, h4, with their numbers"
    assert "<p>1.1.2 Protection may not be available where:</p>" in html, "a paragraph keeps its number as text"
    assert "<ul>\n<li>the person is a critic of the state</li>\n<li>the police are themselves the actors of persecution</li>\n</ul>" in html
    meta = result.meta
    assert (meta["pages"], meta["headings"], meta["footnotes"], meta["list_items"], meta["bookmarks"]) == (4, 4, 1, 2, 4)
    assert (meta["cover_version"], meta["cover_date"]) == ("2.0", "July 2026")
    assert meta["warnings"] == []


def test_furniture_is_left_out(note_pdf):
    html = pdftext.pdf_to_html(note_pdf).html
    for gone in ("Back to Contents", "Page 3 of 4", "Contents", ".........", "Country Policy and Information Note",
                 "gendarmerie"):                    # an entry of the contents list that runs over two lines goes whole
        assert gone not in html, gone


def test_what_a_bulletins_cover_says_under_its_title_is_kept(tmp_path):
    # A bulletin's cover carries its reference, date and summary; GOV.UK's web version opens with them.
    cover = [(300, "Reference: KEN-001-07-26"), (322, "July 2026"),
             (344, "Summary: Updated information on the protection the state offers,"), (358, "between January and June 2026.")]
    html = pdftext.pdf_to_html(_note_pdf(tmp_path / "bulletin.pdf", cover_lines=cover)).html
    assert html.startswith('<div class="govspeak"><p>Reference: KEN-001-07-26</p>\n\n<p>July 2026</p>\n\n'
                           '<p>Summary: Updated information on the protection the state offers, between January and June 2026.</p>')
    assert "Country Policy and Information Note" not in html and "Kenya: Actors of protection" not in html, "but not its title"


def test_a_preface_before_the_contents_is_kept_though_it_has_no_bookmark(tmp_path):
    # Older notes open with a Preface the bookmarks do not name; GOV.UK's web version has it, so the text must.
    result = pdftext.pdf_to_html(_note_pdf(tmp_path / "older.pdf", preface=True))
    assert re.findall(r"<(h[2-4]) id=\"([^\"]+)\">([^<]+)</h", result.html)[:3] == [
        ("h2", "preface", "Preface"), ("h3", "purpose", "Purpose"), ("h2", "assessment", "Assessment")]
    assert "<p>This note provides country of origin information for decision makers.</p>" in result.html
    assert "Country Policy and Information Note" not in result.html, "the cover is still left out"
    assert result.meta["headings"] == 6


def test_footnotes_are_gathered_at_the_end_with_marks_as_govuk_writes_them(note_pdf):
    html = pdftext.pdf_to_html(note_pdf).html
    assert ('effective protection<sup id="fnref:1"><a href="#fn:1" class="footnote" rel="footnote" role="doc-noteref">[footnote 1]</a></sup>. See the'
            in html)
    assert re.search(r'<div class="footnotes" role="doc-endnotes">\s*<ol>\s*<li id="fn:1">\s*<p>USSD, <a rel="external" href="https://example.org/report">'
                     r'Country report</a>, March 2026 <a href="#fnref:1" class="reversefootnote"', html)
    assert "USSD, Country report" not in html.split('<div class="footnotes"')[0], "the footnote is not left in the page's text"


def test_links_cover_exactly_their_words_and_govuk_links_are_not_external(note_pdf):
    html = pdftext.pdf_to_html(note_pdf).html
    assert '<a href="https://www.gov.uk/guidance/credibility">guidance on credibility</a> for more.' in html


def test_a_paragraph_cut_by_a_page_end_is_rejoined(note_pdf):
    html = pdftext.pdf_to_html(note_pdf).html
    assert ("<p>1.1.3 The US Department of State noted in its 2025 Country Report on country Human Rights Practices "
            "that the courts were independent.</p>") in html


def test_a_new_paragraph_at_the_top_of_a_page_is_not_swallowed(tmp_path):
    # The line before had room for "It"; so the next page opens a new paragraph.
    html = pdftext.pdf_to_html(_note_pdf(tmp_path / "n.pdf", cut="It was reported")).html
    assert "on country</p>" in html and "<p>It was reported that the courts were independent.</p>" in html


def test_without_bookmarks_headings_come_from_type_and_numbering(tmp_path):
    result = pdftext.pdf_to_html(_note_pdf(tmp_path / "plain.pdf", bookmarks=False))
    assert [m for m in re.findall(r"<(h[2-4])[^>]*>([^<]+)</h", result.html)] == [
        ("h2", "Assessment"), ("h3", "1. Protection"), ("h4", "1.1 The police"), ("h2", "Country information")]
    assert any("no bookmarks" in w for w in result.meta["warnings"])


def test_a_scan_is_refused_rather_than_guessed_at(tmp_path):
    doc = pymupdf.open()
    for _ in range(3):
        doc.new_page().draw_rect(pymupdf.Rect(50, 50, 500, 700), fill=(0.9, 0.9, 0.9))
    doc.save(tmp_path / "scan.pdf")
    with pytest.raises(pdftext.NoTextLayer):
        pdftext.pdf_to_html(tmp_path / "scan.pdf")


def test_check_measures_an_extraction_against_the_web_version(note_pdf):
    html = pdftext.pdf_to_html(note_pdf).html
    same = pdftext.check(html, html)
    assert same["web_wording_found"] == 1 and same["extracted_wording_in_web"] == 1 and same["web_blocks_found"] == 1
    web = html.replace("the police are themselves the actors of persecution", "the police are themselves implicated in the persecution feared")
    assert pdftext.check(html, web)["web_wording_found"] < 1
    assert pdftext.check(html, web)["footnotes"] == (1, 1)


def test_the_store_keeps_an_extraction_beside_the_pdfs(store, note_pdf):
    from cpin.fingerprint import sha256_bytes
    data = open(note_pdf, "rb").read()
    sha = sha256_bytes(data)
    assert pdftext.extract_into_store(store, sha) is None, "the PDF is not on this disk"
    store.pdf_path(sha).parent.mkdir(parents=True, exist_ok=True)
    store.pdf_path(sha).write_bytes(data)
    meta = pdftext.extract_into_store(store, sha)
    assert meta["extractor"] == pdftext.EXTRACTOR and meta["pdf_sha256"] == sha
    body, held = pdftext.load_text(store, sha)
    assert "1.1.2 Protection may not be available" in body and held["headings"] == 4
    store.pdf_path(sha).unlink()
    assert pdftext.extract_into_store(store, sha)["headings"] == 4, "without the PDF, the text extracted earlier stands"


def _figures_pdf(path, *, stamp=False):
    """A two-page note body with: a picture; a drawn bar chart lettered in another typeface; a passage with
    white strips behind its lines (which is not a picture)."""
    doc = pymupdf.open()
    cover = doc.new_page()
    cover.insert_text((LEFT, 200), "Country Policy and Information Note", fontsize=26)
    crest = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 60))            # the department's logo, on the cover
    crest.set_rect(crest.irect, (20, 20, 20))
    cover.insert_image(pymupdf.Rect(LEFT, 60, LEFT + 120, 120), pixmap=crest)
    p = doc.new_page()
    p.insert_text((LEFT, 96), "Country information", fontsize=26)
    p.insert_text((LEFT, 130), "1.1.1", fontsize=12)
    p.insert_text((TEXT, 130), "The map below shows the provinces of the country in question:", fontsize=12)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 120))
    pix.set_rect(pix.irect, (30, 90, 200))
    p.insert_image(pymupdf.Rect(TEXT, 150, TEXT + 200, 270), pixmap=pix)
    p.insert_text((LEFT, 300), "1.1.2", fontsize=12)
    p.insert_text((TEXT, 300), "The chart below shows the number of events recorded each year:", fontsize=12)
    p.insert_text((TEXT + 60, 330), "Events by year", fontsize=14, fontname="tiro")          # the chart's title
    for i, (h, year) in enumerate([(60, "2021"), (90, "2022"), (40, "2023"), (75, "2024")]):
        x = TEXT + 40 + i * 60
        p.draw_rect(pymupdf.Rect(x, 450 - h, x + 30, 450), fill=(0.2, 0.4, 0.8), color=None)
        p.insert_text((x + 2, 464), year, fontsize=9, fontname="tiro")
    for i, tick in enumerate(["0", "50", "100"]):
        p.insert_text((TEXT + 10, 452 - i * 45), tick, fontsize=9, fontname="tiro")
    p.draw_line((TEXT + 34, 350), (TEXT + 34, 450))
    p.draw_line((TEXT + 34, 450), (TEXT + 290, 450))
    p.insert_text((LEFT, 500), "1.1.3", fontsize=12)
    words = ["The security forces were reported to have responded to most of the events recorded in", "the capital, and to few of those recorded in the provinces, according to the same source,",
             "which also said that its figures for the most recent year were provisional and incomplete.", "It added that the figures for earlier years had been revised since they were first given."]
    for i, line in enumerate(words):
        if i:
            p.draw_rect(pymupdf.Rect(TEXT - 1, 504 + i * 14 - 12, RIGHT, 504 + i * 14 + 2), fill=(1, 1, 1), color=None)   # Word's white strip behind a line
        p.insert_text((TEXT, 500 + i * 14), line, fontsize=10 if i else 12)
    for k in range(8):                                                                    # more strips, as shading has
        p.draw_rect(pymupdf.Rect(TEXT - 1, 560 + k * 14, RIGHT, 572 + k * 14), fill=(1, 1, 1), color=None)
    if stamp:                                                                              # a translator's stamp: a small mark
        mark = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 90, 40))
        mark.set_rect(mark.irect, (120, 20, 20))
        p.insert_text((LEFT, 700), "1.1.4", fontsize=12)
        p.insert_text((TEXT, 700), "The translation was certified by the agency whose stamp is below:", fontsize=12)
        p.insert_image(pymupdf.Rect(TEXT, 712, TEXT + 135, 772), pixmap=mark)                # 60 pt high: a strip, not a map
    doc.set_toc([[1, "Country information", 2]])
    doc.save(path)
    doc.close()
    return path


def test_pictures_and_drawn_charts_become_figures_in_their_place(tmp_path):
    result = pdftext.pdf_to_html(_figures_pdf(tmp_path / "figs.pdf"))
    html = result.html
    figures = re.findall(r'<figure class="image embedded"><div class="img"><img src="pdf-image:([0-9a-f]{64}\.png)" alt=""></div></figure>', html)
    assert len(figures) == 2 and result.meta["figures"] == 2, "the picture and the chart; nothing else (not the cover's logo)"
    assert set(figures) == set(result.images), "each figure's image is returned with the text"
    assert all(data[:8] == b"\x89PNG\r\n\x1a\n" for data in result.images.values())
    order = [m.start() for m in re.finditer(r"1\.1\.1|1\.1\.2|1\.1\.3|<figure", html)]
    kinds = re.findall(r"1\.1\.1|1\.1\.2|1\.1\.3|<figure", html)
    assert kinds == ["1.1.1", "<figure", "1.1.2", "<figure", "1.1.3"] and order == sorted(order), "each sits after the paragraph that introduces it"


def test_withdrawal_sheet_before_cover_does_not_show_the_department_logo(tmp_path):
    path = _figures_pdf(tmp_path / "withdrawn.pdf")
    with pymupdf.open(path) as doc:
        doc[0].insert_text((LEFT, 300), "Version 2.0", fontsize=12)
        doc[0].insert_text((LEFT, 320), "July 2026", fontsize=12)
        notice = doc.new_page(pno=0)
        notice.insert_text((LEFT, 120), "This publication was archived", fontsize=26)
        notice.insert_text((LEFT, 180), "This publication is no longer current and is not being updated.", fontsize=12)
        doc.set_toc([[1, "Country information", 3]])
        doc.saveIncr()
    result = pdftext.pdf_to_html(path)
    assert result.meta["figures"] == 2
    assert set(result.meta["figure_pages"].values()) == {3}
    assert result.meta["cover_version"] == "2.0"
    assert result.meta["cover_date"] == "July 2026"
    assert "Country Policy and Information Note" not in result.html
    assert "no longer current and is not being updated" in result.html


def test_diagonal_archive_watermark_is_not_part_of_a_quotation(tmp_path):
    path = _figures_pdf(tmp_path / 'watermark.pdf')
    with pymupdf.open(path) as doc:
        doc[1].insert_text((140, 500), 'Archived', fontsize=80,
                           morph=(pymupdf.Point(140, 500), pymupdf.Matrix(45)))
        doc[1].insert_text((TEXT, 650), 'Archived reports remain available for reference.', fontsize=12)
        doc.saveIncr()
    result = pdftext.pdf_to_html(path)
    assert result.html.count('Archived') == 1
    assert 'Archived reports remain available for reference.' in result.html


def test_a_charts_lettering_is_part_of_the_picture_not_stray_paragraphs(tmp_path):
    html = pdftext.pdf_to_html(_figures_pdf(tmp_path / "figs.pdf")).html
    text = re.sub(r"<[^>]+>", " ", html)
    for lettering in ("Events by year", "2022", "100"):
        assert lettering not in text, lettering


def test_shading_behind_ordinary_text_is_not_a_figure_and_the_text_is_kept(tmp_path):
    html = pdftext.pdf_to_html(_figures_pdf(tmp_path / "figs.pdf")).html
    assert "<p>1.1.3 The security forces were reported to have responded to most of the events recorded in" in html
    assert "provisional and incomplete" in html and "revised since they were first given" in html


def test_figures_are_kept_with_the_text_in_the_store(store, tmp_path):
    from cpin.fingerprint import sha256_bytes
    data = open(_figures_pdf(tmp_path / "figs.pdf"), "rb").read()
    sha = sha256_bytes(data)
    store.pdf_path(sha).parent.mkdir(parents=True, exist_ok=True)
    store.pdf_path(sha).write_bytes(data)
    meta = pdftext.extract_into_store(store, sha)
    assert len(meta["images"]) == 2
    for name in meta["images"]:
        assert (pdftext.text_dir(store) / "images" / name).read_bytes()[:4] == b"\x89PNG"


def test_a_photograph_is_kept_as_a_jpeg_and_a_flat_picture_as_a_png(tmp_path):
    # Shaded like a photograph or a relief map: every pixel differs from its neighbours, so a PNG is large.
    import random
    rnd, w, h = random.Random(7), 480, 320
    samples = bytes(max(0, min(255, base + rnd.randint(-9, 9)))
                    for y in range(h) for x in range(w) for base in (x * 255 // w, y * 255 // h, 140))
    doc = pymupdf.open()
    doc.new_page().insert_text((LEFT, 200), "Country Policy and Information Note", fontsize=26)
    p = doc.new_page()
    p.insert_text((LEFT, 96), "Country information", fontsize=26)
    p.insert_text((LEFT, 130), "1.1.1", fontsize=12)
    p.insert_text((TEXT, 130), "The photograph below shows the border crossing in question:", fontsize=12)
    p.insert_image(pymupdf.Rect(TEXT, 150, TEXT + 360, 390), pixmap=pymupdf.Pixmap(pymupdf.csRGB, w, h, samples, False))
    p.insert_text((LEFT, 420), "1.1.2", fontsize=12)
    p.insert_text((TEXT, 420), "The diagram below shows the same crossing in outline:", fontsize=12)
    flat = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 120))
    flat.set_rect(flat.irect, (30, 90, 200))
    p.insert_image(pymupdf.Rect(TEXT, 440, TEXT + 200, 560), pixmap=flat)
    doc.set_toc([[1, "Country information", 2]])
    doc.save(tmp_path / "photo.pdf")
    result = pdftext.pdf_to_html(tmp_path / "photo.pdf")
    names = re.findall(r'<img src="pdf-image:([0-9a-f]{64}\.(?:png|jpg))"', result.html)
    assert [n.rsplit(".", 1)[1] for n in names] == ["jpg", "png"] and set(names) == set(result.images)
    photo, diagram = (result.images[n] for n in names)
    assert photo[:3] == b"\xff\xd8\xff" and diagram[:4] == b"\x89PNG"
    assert len(photo) < pdftext.JPEG_OVER, "and far smaller than the PNG it replaces"
    assert set(result.meta["figure_pages"]) == set(names)


# --- pictures a PDF has and the web version of the same edition leaves out ---

def _fig(name):
    return f'<figure class="image embedded"><div class="img"><img src="pdf-image:{name}" alt=""></div></figure>'


def test_a_picture_the_web_version_lacks_is_placed_after_the_block_it_follows():
    mark = '<sup id="fnref:3"><a href="#fn:3" class="footnote">[footnote 3]</a></sup>'
    pdf = (f'<div class="govspeak"><h2 id="a">Security</h2><p>1.1.1 The map below shows it.{mark}</p>{_fig("a.png")}'
           f'<p>1.1.2 Sources reported fighting.</p>{_fig("b.png")}<ul><li>in the north</li></ul>{_fig("c.jpg")}{_fig("d.png")}</div>')
    web = ('<div class="govspeak"><h2 id="a">Security</h2><p>1.1.1 The map below shows it.<sup id="fnref:9"><a href="#fn:9">[footnote 9]</a></sup></p>'
           '<p>1.1.2 Sources reported fighting.</p><figure class="image embedded"><div class="img"><img src="https://assets.example/b.png"></div></figure>'
           '<ul><li>in the north</li></ul></div>')
    found = pdftext.figures_missing_from_web(pdf, web)
    assert [(f["image"], f["tag"], f["index"], f["key"]) for f in found["figures"]] == [
        ("a.png", "p", 0, "111themapbelowshowsit"),          # the web has no picture between 1.1.1 and 1.1.2
        ("c.jpg", "li", 0, "inthenorth"), ("d.png", "li", 0, "inthenorth")], "b is the picture the web version shows after 1.1.2"
    assert (found["pdf_figures"], found["web_figures"], found["unplaced"]) == (4, 1, 0)


def test_a_picture_is_not_hung_on_a_block_the_web_words_differently_and_one_before_any_block_is_only_counted():
    pdf = f'<div class="govspeak">{_fig("first.png")}<p>1.1.1 The same words.</p><p>1.1.2 Words only the PDF has.</p>{_fig("x.png")}<p>1.1.3 The end.</p></div>'
    web = '<div class="govspeak"><p>1.1.1 The same words.</p><p>1.1.2 Words the web version changed.</p><p>1.1.3 The end.</p></div>'
    found = pdftext.figures_missing_from_web(pdf, web)
    assert [(f["image"], f["index"]) for f in found["figures"]] == [("x.png", 0)], "after the last block both versions share: 1.1.1"
    assert found["unplaced"] == 1


def test_the_store_keeps_the_pictures_a_web_version_leaves_out_but_not_a_stamp(store, tmp_path):
    from cpin.fingerprint import sha256_bytes
    path = _figures_pdf(tmp_path / "figs.pdf", stamp=True)
    sha = sha256_bytes(open(path, "rb").read())
    web = ('<div class="govspeak"><h2 id="country-information">Country information</h2>'
           '<p>1.1.1 The map below shows the provinces of the country in question:</p>'
           '<p>1.1.2 The chart below shows the number of events recorded each year:</p>'
           '<p>1.1.3 The security forces were reported to have responded.</p>'
           '<p>1.1.4 The translation was certified by the agency whose stamp is below:</p></div>')
    job = ("kenya/note", str(path), sha, web, "b" * 64)
    summary = pdftext.missing_figures_into_store(store, [job], workers=1)
    assert (summary["pairs"], summary["figures"], summary["unplaced"], summary["errors"]) == (1, 2, 0, 0)
    held = pdftext.load_figures(store, sha)
    assert [(f["tag"], f["index"], f["page"]) for f in held["figures"]] == [("p", 0, 2), ("p", 1, 2)], "the map and the chart, after their paragraphs"
    assert held["left_in_pdf"] == {"small": 1} and held["body_sha256"] == "b" * 64 and held["extractor"] == pdftext.EXTRACTOR
    images = sorted(f.name for f in (pdftext.text_dir(store) / "images").iterdir())
    assert images == sorted(f["image"] for f in held["figures"]), "only the pictures carried over are kept"
    again = pdftext.missing_figures_into_store(store, [job], workers=1)
    assert again["done_before"] == 1 and again["figures"] == 2
    assert pdftext.missing_figures_into_store(store, [(*job[:4], "c" * 64)], workers=1)["done_before"] == 0, "a changed web body is worked out afresh"


def test_a_shaded_tables_lines_are_put_back_into_their_cells():
    # Shading behind each line of a cell reads as a row boundary: most "rows" then hold one cell's next line,
    # and the shading's edges split a column in two.
    cell = lambda text: [pdftext.Piece(text, 10, 0, "Arial")] if text else []
    rows = [[cell(t) for t in row] for row in [
        ["Personal details", "Date arrested", "Date released", "", "", "Charges"],
        ["Name: A", "March 2012", "", "Meant to be", "", "Sentenced to 12"],
        ["", "", "", "released in", "", ""],
        ["", "", "", "March 2024.", "", ""],
        ["", "", "", "", "", "years in prison"],
        ["", "", "", "", "", "and 5 years of"],
        ["", "", "", "", "", "probation."],
        ["Name: B", "May 2013", "", "Still detained.", "", "Sentenced to 9 years."]]]
    has = lambda c: any(p.text.strip() for p in c)
    filled = [sum(1 for c in row if has(c)) for row in rows]
    assert pdftext._shaded(filled, 6)
    assert not pdftext._shaded([4, 4, 4, 3, 4, 4, 1, 4], 6), "an ordinary table with one sparse row is left as it is"
    text = [["".join(p.text for p in c) for c in row] for row in pdftext._regroup(rows, has)]
    assert text == [["Personal details", "Date arrested", "Date released", "Charges"],
                    ["Name: A", "March 2012", "Meant to be released in March 2024.", "Sentenced to 12 years in prison and 5 years of probation."],
                    ["Name: B", "May 2013", "Still detained.", "Sentenced to 9 years."]]


def test_the_covers_date_keeps_its_day_and_a_version_number_is_not_taken_for_one():
    line = lambda text: pdftext.Line(0, 72, 300, 300, 314, [pdftext.Piece(text, 12, 0, "Arial")])
    assert pdftext._cover([line("Version 7.0"), line("18 December 2025")])["cover_date"] == "18 December 2025"
    assert pdftext._cover([line("Version 2.0"), line("July 2026")])["cover_date"] == "July 2026"


def test_marks_set_together_are_each_a_footnote_mark():
    notes = {str(n) for n in range(1, 200)}
    assert pdftext._note_numbers("33,34", notes) == ["33", "34"]
    assert pdftext._note_numbers("70 71 72", notes) == ["70", "71", "72"]
    assert pdftext._note_numbers("178179180", notes) == ["178", "179", "180"], "run together: numbers that follow one another"
    assert pdftext._note_numbers("910", notes) == ["9", "10"]
    assert pdftext._note_numbers("4", notes) == ["4"]
    assert pdftext._note_numbers("2024", notes) is None and pdftext._note_numbers("250", notes) is None, "a year, or a number with no footnote"
    raised = pdftext.Piece("33,34", 8, 0, "Arial", raised=True)
    html = pdftext._inline([pdftext.Piece("academia", 12, 0, "Arial"), raised, pdftext.Piece(".", 12, 0, "Arial")], notes=notes, marked=set())
    assert html.count('class="footnote"') == 2 and "[footnote 33]" in html and "[footnote 34]" in html and "33,34" not in html


def test_a_repeated_block_does_not_pull_the_pictures_out_of_place():
    # The PDF repeats the notice of a redacted section for every withheld paragraph; the web gives it once. Both
    # have the same two pictures at the same places: none is missing.
    notice = "<p>The information in this section has been removed.</p>"
    body = lambda n, fig: (f'<div class="govspeak"><p>1.1.1 First.</p>{notice * n}<p>1.1.2 The map below.</p>{fig("m")}'
                           f'<p>2.1.1 Later.</p>{notice * n}<p>2.1.2 The chart below.</p>{fig("c")}<p>2.1.3 End.</p></div>')
    web_fig = lambda name: f'<figure class="image embedded"><div class="img"><img src="https://assets.example/{name}.png"></div></figure>'
    found = pdftext.figures_missing_from_web(body(6, lambda name: _fig(name + ".png")), body(1, web_fig))
    assert found["figures"] == [] and (found["pdf_figures"], found["web_figures"]) == (2, 2)


def test_a_web_picture_set_a_block_later_accounts_for_the_pdfs():
    pdf = f'<div class="govspeak"><p>1.1.1 The map below.</p>{_fig("map.png")}<p>1.1.2 Next.</p>{_fig("only.png")}<p>1.1.3 End.</p></div>'
    web = ('<div class="govspeak"><p>1.1.1 The map below.</p><p>1.1.2 Next.</p>'
           '<figure class="image embedded"><div class="img"><img src="https://assets.example/map.png"></div></figure><p>1.1.3 End.</p></div>')
    found = pdftext.figures_missing_from_web(pdf, web)
    assert len(found["figures"]) == found["pdf_figures"] - found["web_figures"] == 1, "never more than the PDF's surplus"


def test_the_end_of_a_contents_list_on_its_own_page_and_a_wrapped_entry_are_left_out():
    line = lambda y, text: pdftext.Line(1, 72, y, 500, y + 13, [pdftext.Piece(text, 12, 0, "Arial")])
    last = [line(80, "11.3 The Public Prosecutor’s Office and National Council of the Public"), line(94, "Ministry ................................ 27"),
            line(113, "Feedback to the Home Office ............. 32"), line(200, "Preface")]
    kept, was = pdftext._without_contents(list(last), carried=True)
    assert [l.text for l in kept] == ["Preface"] and was, "two entries are enough where the list carries on from the page before"
    kept, was = pdftext._without_contents(list(last), carried=False)
    assert len(kept) == 4 and not was, "on their own, two lines ending in a number are not a contents list"


def test_old_contents_references_are_removed_but_the_body_on_the_same_page_is_kept():
    def line(y, *texts, x=72):
        return pdftext.Line(0, x, y, 540, y + 13, [pdftext.Piece(t, 12, 0, "Arial") for t in texts])
    body = line(230, "1. Introduction")
    quotation = line(250, "1.1 A genuine quotation .... and a year 2012.")
    lines = [line(80, "Contents"), line(110, "1. Introduction ", "1.1 – 1.4"),
             line(140, "2. Assessment ", "2.1"), line(170, "3. Claims ", "3.1 – 3.4"), body, quotation]
    kept, was = pdftext._without_contents(lines)
    assert was and kept == [body, quotation]
    assert pdftext._without_contents(lines[1:])[0] == lines[1:], "plain references require a contents title"


def test_decimal_contents_and_a_plain_last_row_do_not_leak_into_the_body():
    line = lambda y, text: pdftext.Line(0, 72, y, 540, y + 13, [pdftext.Piece(text, 12, 0, "Arial")])
    lines = [line(80, "Contents"), line(105, "Geography ........ 1.01"), line(125, "Economy ........ 2.08"),
             line(145, "History ........ 3.01"), line(162, "Version control 53"), line(220, "1. Geography")]
    kept, was = pdftext._without_contents(lines)
    assert was and kept == lines[-1:]


def test_word_bookmark_errors_are_only_removed_within_a_proven_contents_list():
    line = lambda y, text: pdftext.Line(0, 72, y, 540, y + 13, [pdftext.Piece(text, 12, 0, "Arial")])
    lines = [line(80, "Contents"), line(105, "Introduction ........ Error! Bookmark not defined."),
             line(135, "Law ........ Error! Bookmark not defined."),
             line(165, "History ........ Error! Bookmark"), line(181, "not defined."),
             line(240, "A source says (n Error! Bookmark not defined.) and supplies no number.")]
    assert pdftext._without_contents(lines)[0] == lines[-1:]
    assert pdftext._without_contents(lines[1:])[0] == lines[1:], "a source's own errors stay untouched"


def test_only_a_linked_navigation_suffix_is_trimmed_from_a_source_sentence():
    def line(link):
        return pdftext.Line(0, 72, 200, 540, 213, [pdftext.Piece("1.1 The evidence remains. ", 12, 0, "Arial"),
                            pdftext.Piece("Back to Contents", 12, 0, "Arial", goto=link)])
    audit = []
    assert pdftext._without_navigation(line((1, 80)), audit).text == "1.1 The evidence remains. "
    assert audit[0]["text"] == "Back to Contents" and audit[0]["page"] == 1
    literal = line(None)
    assert pdftext._without_navigation(literal).text == literal.text


def test_repeated_dated_headers_and_inset_footers_are_removed_with_original_words_kept(tmp_path):
    doc = pymupdf.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 35), "Example OGN v7 March 2013", fontsize=10)
        page.insert_text((72, 120), f"1.{i + 1} The source paragraph remains unchanged.", fontsize=12)
        page.insert_text((72, 160), "Example OGN v7 March 2013 is quoted in the body.", fontsize=12)
        page.insert_text((72, 200), "A form contains dots .... and a printed number 42.", fontsize=12)
        page.insert_text((72, 730), "This substantive source note must remain.", fontsize=9)
        page.insert_text((275, 715), f"Page {i + 1} of 3", fontsize=8)
    path = tmp_path / "old-template.pdf"
    doc.save(path)
    doc.close()
    result = pdftext.pdf_to_html(path)
    assert result.html.count("Example OGN v7 March 2013") == 3, "body quotations are untouched"
    assert result.html.count("The source paragraph remains unchanged.") == 3
    assert "Page 1 of 3" not in result.html and "Page 2 of 3" not in result.html
    assert "A form contains dots .... and a printed number 42." in result.html
    assert result.html.count("This substantive source note must remain.") == 3
    assert (result.meta["cover_version"], result.meta["cover_date"]) == ("7", "March 2013"), "v7 is a version, not a day of the month"
    assert result.html.startswith('<div class="govspeak"><p>Version 7, March 2013</p>')
    assert sum(o["kind"] == "running header" for o in result.meta["omitted_furniture"]) == 3


def test_navigation_is_removed_before_it_can_merge_with_a_paragraph_baseline(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 120), "1.1 A complete source sentence.", fontsize=12)
    page.insert_text((420, 120), "Back to Contents", fontsize=10)
    page.insert_text((72, 160), "1.2 The next paragraph is preserved.", fontsize=12)
    path = tmp_path / "navigation.pdf"
    doc.save(path)
    doc.close()
    html = pdftext.pdf_to_html(path).html
    assert "Back to Contents" not in html
    assert "1.1 A complete source sentence." in html and "1.2 The next paragraph is preserved." in html


def test_a_raw_line_spanning_multiple_physical_baselines_is_split_before_joining():
    doc = pymupdf.open()
    page = doc.new_page()
    for y, text in [(120, "Notify the authority."), (136, "The court may impose a penalty."),
                    (170, "The next programme is described separately.")]:
        page.insert_text((72, y), text, fontsize=12)
    raw = [line for b in page.get_text("rawdict")["blocks"] for line in b.get("lines", [])]
    # The defect found in older Word PDFs: all three real lines are held as one tall raw run.
    combined = {**raw[0], "spans": [s for l in raw for s in l["spans"]], "bbox": (72, 100, 500, 180)}
    split = pdftext._visual_lines(combined)
    assert ["".join(ch["c"] for s in l["spans"] for ch in s["chars"]) for l in split] == [
        "Notify the authority.", "The court may impose a penalty.", "The next programme is described separately."]
    assert all(l["bbox"][3] - l["bbox"][1] < 20 for l in split)
    doc.close()


def test_a_tall_whitespace_glyph_does_not_merge_adjacent_source_sentences():
    from types import SimpleNamespace
    doc = pymupdf.open()
    page = doc.new_page()
    texts = ["Notify the authority.", "The court may impose a penalty.", "Court... ", "The next programme is separate."]
    for y, text in zip([120, 136, 152, 172], texts):
        page.insert_text((72, y), text, fontsize=12)
    raw = page.get_text("rawdict")
    for b in raw["blocks"]:
        for line in b.get("lines", []):
            if "".join(ch["c"] for s in line["spans"] for ch in s["chars"]).startswith("Court..."):
                # A malformed whitespace box, as found in old embedded fonts: source ink is unchanged.
                line["spans"][-1]["chars"][-1]["bbox"] = (115, 125, 118, 180)
                line["bbox"] = (72, 125, 118, 180)
    fake_page = SimpleNamespace(get_links=lambda: [], get_text=lambda *a, **k: raw)
    lines, _ = pdftext._page_lines(fake_page, 0, pymupdf)
    assert [l.text.strip() for l in lines] == [t.strip() for t in texts]
    assert all(l.y1 - l.y0 < 20 for l in lines)
    doc.close()


def test_rotated_table_labels_remain_whole_in_the_cell_reader():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((120, 200), "Medical registration", fontsize=12, rotate=90)
    raw = [line for b in page.get_text("rawdict")["blocks"] for line in b.get("lines", [])]
    assert len(pdftext._visual_lines(raw[0])) == 1
    _, runs = pdftext._page_lines(page, 0, pymupdf)
    assert [r.text for r in runs] == ["Medical registration"]
    doc.close()


def test_a_bordered_prose_table_in_an_annex_is_not_a_chart_because_its_font_differs(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    for i in range(10):
        page.insert_text((72, 80 + 15 * i), "The main report uses this typeface for its ordinary substantive text.", fontsize=12)
    for x in [72, 285, 540]:
        page.draw_line((x, 250), (x, 430))
    for y in [250, 280, 330, 380, 430]:
        page.draw_line((72, y), (540, y))
    for i in range(4):
        for x, label in [(78, "Institution"), (291, "Training content")]:
            y = [270, 295, 345, 395][i]
            page.insert_text((x, y), label if i == 0 else
                             "Detailed source information about", fontsize=11, fontname="tiro")
            if i:
                page.insert_text((x, y + 13), "the institution and training provided.", fontsize=11, fontname="tiro")
                page.insert_text((x, y + 26), "including its continuing work and staff.", fontsize=11, fontname="tiro")
    path = tmp_path / "annex-table.pdf"
    doc.save(path)
    doc.close()
    result = pdftext.pdf_to_html(path)
    assert result.meta["tables"] == 1 and result.meta["figures"] == 0
    assert "Detailed source information about the institution and training provided." in result.html


def test_a_lone_o_is_a_bullet_in_any_typeface_but_a_wrapped_line_opening_with_the_word_is_not(tmp_path):
    doc = pymupdf.open()
    doc.new_page().insert_text((LEFT, 200), "Country Policy and Information Note", fontsize=26)
    p = doc.new_page()
    p.insert_text((LEFT, 96), "Country information", fontsize=26)
    p.insert_text((LEFT, 130), "1.1.1", fontsize=12)
    p.insert_text((TEXT, 130), "The plan covers:", fontsize=12)
    for i, item in enumerate(["law and policy on mental health", "services in the community"]):
        p.insert_text((TEXT + 18, 150 + i * 16), "o", fontsize=12)                       # Helvetica, not Courier
        p.insert_text((TEXT + 36, 150 + i * 16), item, fontsize=12)
    p.insert_text((LEFT, 210), "1.1.2", fontsize=12)
    p.insert_text((TEXT, 210), "The constitution says, in the original: a lei estabelecerá que", fontsize=12)
    p.insert_text((TEXT, 224), "o Ministério Público é instituição permanente.", fontsize=12)
    doc.set_toc([[1, "Country information", 2]])
    doc.save(tmp_path / "o.pdf")
    html = pdftext.pdf_to_html(tmp_path / "o.pdf").html
    assert "<li>law and policy on mental health</li>\n<li>services in the community</li>" in html
    assert "estabelecerá que o Ministério Público é instituição permanente.</p>" in html


def test_a_picture_follows_the_paragraph_that_introduces_it_though_the_web_ends_it_differently():
    pdf = (f'<div class="govspeak"><p>7.1.3 Sana’a is the largest city in the country.</p>'
           f'<p>7.1.4 OnTheWorldMap published the following 2021 map of Yemen showing its 22 governorates:</p>{_fig("map.jpg")}'
           f'<p>7.1.5 The population was estimated at 34 million.</p></div>')
    web = ('<div class="govspeak"><p>7.1.3 Sana’a is the largest city in the country.</p>'
           '<p>7.1.4 OnTheWorldMap published the following 2021 map of Yemen showing its 22 governorates: <a href="https://example.org/map">Yemen governorates map</a></p>'
           '<p>7.1.5 The population was estimated at 34 million.</p></div>')
    (figure,) = pdftext.figures_missing_from_web(pdf, web)["figures"]
    assert (figure["tag"], figure["index"]) == ("p", 1) and figure["key"].startswith("714ontheworldmap"), "after 7.1.4, not before it"
