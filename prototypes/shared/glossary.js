// The glossary: what the abbreviations and terms on this site mean, in plain words. Used by the guide
// page (prototypes/guide/) and by the site's search, which lists matching terms under its results.
// The explanations are this site's own, written to be short and neutral; they are not Home Office text
// and are not legal advice. `group` says where a term comes from: the notes themselves, asylum law, or
// this site. `aka` are other words people type for the same thing (searched, not shown).
// Pure data and functions: tested in web/test/glossary.test.mjs.

export const GROUPS = { notes: "The notes", law: "Asylum law", site: "This site" };

export const GLOSSARY = [
  // ---- the notes ------------------------------------------------------------------------------
  { id: "cpin", term: "CPIN", full: "Country Policy and Information Note", group: "notes", aka: ["country report", "country reports", "country note", "cpins", "country policy note"],
    def: "The Home Office’s guidance for its decision makers on asylum and human rights claims from one country, usually on one subject (for example military service in Iran). Each note sets out the Home Office’s assessment and the country information it rests on. They are published on GOV.UK and replaced as situations change." },
  { id: "coi", term: "COI", full: "Country of origin information", group: "notes", aka: ["country information", "country evidence"],
    def: "Evidence about conditions in a country, taken from published sources and cited in footnotes. It is the ‘Country information’ part of a note, kept separate from the Home Office’s assessment of it." },
  { id: "assessment", term: "Assessment", group: "notes", aka: ["policy", "guidance", "analysis"],
    def: "The part of a note that gives the Home Office’s view of the evidence for its decision makers: who is likely to be at risk, whether the state can protect them, and whether they could live elsewhere in the country. It is the Home Office’s position, not a finding of a court." },
  { id: "executive-summary", term: "Executive summary", group: "notes", aka: ["summary"],
    def: "The short opening of a recent note, stating its main conclusions. Older editions have no executive summary." },
  { id: "cin", term: "Country information note", full: "CIN", group: "notes", aka: ["cin", "cins", "information note"],
    def: "A Home Office note that gives country information only, with no assessment: for example on medical treatment and healthcare." },
  { id: "country-bulletin", term: "Country bulletin", group: "notes", aka: ["bulletin", "bulletins"],
    def: "A shorter Home Office note on a particular development or question, outside the usual format of a CPIN. Bulletins often have no version number." },
  { id: "ffm", term: "Report of a fact-finding mission", full: "FFM", group: "notes", aka: ["ffm", "fact finding mission", "fact-finding", "mission report"],
    def: "The Home Office’s report of a visit to a country to gather information first hand, made up mostly of notes of its meetings with people and organisations there." },
  { id: "cig", term: "Country information and guidance", full: "CIG", group: "notes", aka: ["cig", "legacy"],
    def: "The name these notes had before they became CPINs, around 2016 to 2017. A few are still published under it; this site marks them ‘legacy’." },
  { id: "cpit", term: "CPIT", full: "Country Policy and Information Team", group: "notes", aka: ["country policy and information team"],
    def: "The Home Office team that researches and writes the notes." },
  { id: "iagci", term: "IAGCI", full: "Independent Advisory Group on Country Information", group: "notes", aka: ["advisory group", "iagci review"],
    def: "An independent group that reviews the Home Office’s country information for the Independent Chief Inspector of Borders and Immigration. A note ‘updated per IAGCI review’ was changed in response to one of its reviews." },
  { id: "icibi", term: "ICIBI", full: "Independent Chief Inspector of Borders and Immigration", group: "notes", aka: ["chief inspector"],
    def: "The independent inspector of the Home Office’s border and immigration work. The IAGCI reports to the Chief Inspector." },
  { id: "decision-maker", term: "Decision maker", group: "notes", aka: ["decision makers", "caseworker", "caseworkers"],
    def: "The Home Office official who decides an asylum or human rights claim. The notes are written for decision makers, which is why they speak of what a decision maker must consider." },
  { id: "version", term: "Version", group: "notes", aka: ["version number", "v1", "v2"],
    def: "The number the Home Office gives each issue of a note (1.0, 2.0 …), stated in the note itself. A new version replaces the old one on GOV.UK. Some documents, such as bulletins, have none." },
  { id: "valid-from", term: "Valid from", group: "notes", aka: ["cleared", "clearance"],
    def: "The date from which the Home Office says a version applies, given in the note’s ‘Version control’ section. It can differ from the date the note appeared on GOV.UK." },
  { id: "changes-from-last-version", term: "Changes from last version", group: "notes", aka: ["what changed", "change statement"],
    def: "The Home Office’s own sentence, in a note’s ‘Version control’ section, saying what changed since the version before. This site shows it word for word above each edition." },

  // ---- asylum law -----------------------------------------------------------------------------
  { id: "refugee-convention", term: "Refugee Convention", group: "law", aka: ["1951 convention", "geneva convention"],
    def: "The 1951 United Nations Convention relating to the Status of Refugees and its 1967 Protocol: the treaty that defines who is a refugee and what protection they are owed." },
  { id: "convention-reason", term: "Convention reason", group: "law", aka: ["convention reasons", "convention grounds"],
    def: "One of the five grounds in the Refugee Convention: race, religion, nationality, membership of a particular social group, or political opinion. To be a refugee a person’s fear of persecution must be for one of them." },
  { id: "psg", term: "Particular social group", full: "PSG", group: "law", aka: ["psg", "social group"],
    def: "One of the five Convention reasons: a group of people who share a characteristic they cannot change or should not be required to change, and who are seen as a distinct group in their society." },
  { id: "persecution", term: "Persecution and serious harm", group: "law", aka: ["persecution", "serious harm", "real risk"],
    def: "The kinds of ill-treatment that asylum law protects against. The notes ask whether a person faces a ‘real risk’ of them on return." },
  { id: "actors-of-protection", term: "Actors of protection", group: "law", aka: ["protection", "state protection"],
    def: "Those who can protect a person against persecution or serious harm: the state, or bodies that control the state or a large part of it. Also the title of a common note on how well a country’s police, courts and other institutions work." },
  { id: "sufficiency-of-protection", term: "Sufficiency of protection", group: "law", aka: ["effective protection"],
    def: "Whether the protection available in a country is enough in practice: broadly, a working system to detect, prosecute and punish the harm feared, which the person is able to use." },
  { id: "internal-relocation", term: "Internal relocation", group: "law", aka: ["internal flight", "relocation", "internal flight alternative"],
    def: "Whether a person at risk in one part of their country could reasonably be expected to live safely in another part of it, instead of needing protection abroad." },
  { id: "humanitarian-protection", term: "Humanitarian protection", group: "law", aka: ["hp", "subsidiary protection"],
    def: "Protection for a person who is not a refugee but faces a real risk of serious harm if returned." },
  { id: "article-15c", term: "Article 15(c)", group: "law", aka: ["15c", "15(c)", "indiscriminate violence"],
    def: "Shorthand for a serious threat to a civilian’s life or person from indiscriminate violence in an armed conflict, one of the forms of serious harm that can lead to humanitarian protection. The name comes from Article 15(c) of the EU Qualification Directive, and the test is now part of UK immigration rules. ‘15c generally met’ in a note means the violence in an area is judged severe enough to put civilians there at risk just by being present." },
  { id: "article-3", term: "Article 3", group: "law", aka: ["article 3 echr", "echr", "torture"],
    def: "Article 3 of the European Convention on Human Rights: no one may be subjected to torture or to inhuman or degrading treatment or punishment. A person cannot be returned to a real risk of it." },
  { id: "exclusion", term: "Exclusion", group: "law", aka: ["article 1f", "1f", "excluded"],
    def: "Whether a person is shut out of refugee status or humanitarian protection because of what they have done, such as war crimes or other serious crimes (Article 1F of the Refugee Convention)." },
  { id: "certification", term: "Certification", group: "law", aka: ["clearly unfounded", "section 94", "certified"],
    def: "A decision that a refused claim is ‘clearly unfounded’ under section 94 of the Nationality, Immigration and Asylum Act 2002, which takes away the right of appeal (older claims could still be appealed, but only from outside the UK). Notes usually say whether claims of that kind are likely to be certifiable." },
  { id: "country-guidance", term: "Country guidance", full: "CG", group: "law", aka: ["cg", "cg case", "country guidance case", "country guidance cases"],
    def: "A decision of the Upper Tribunal marked as country guidance: its findings about a country are to be followed in later appeals on the same issue unless there are very strong grounds, supported by cogent evidence, to depart from them. Notes cite these cases and sometimes say the evidence has moved on." },
  { id: "tribunals", term: "Tribunals", full: "First-tier Tribunal and Upper Tribunal", group: "law", aka: ["upper tribunal", "first-tier tribunal", "ut", "ftt", "iac", "immigration and asylum chamber"],
    def: "The independent tribunals that hear immigration and asylum appeals (their Immigration and Asylum Chambers). Appeals start in the First-tier Tribunal; the Upper Tribunal hears onward appeals and gives country guidance." },
  { id: "refoulement", term: "Refoulement", group: "law", aka: ["non-refoulement", "non refoulement"],
    def: "Sending a person to a country where they face persecution or serious harm. The Refugee Convention and human rights law forbid it; the rule is called non-refoulement." },
  { id: "sur-place", term: "Sur place", group: "law", aka: ["sur place activities", "sur place claim"],
    def: "A claim based on things that happened after the person left their country, such as political activity in the UK or online, rather than on what happened to them there." },
  { id: "safe-third-country", term: "Safe third country", group: "law", aka: ["third country", "inadmissible", "inadmissibility"],
    def: "A country, other than the person’s own, where they could have claimed asylum or to which they could be sent, and which is considered safe for them." },
  { id: "sogie", term: "SOGIE", full: "Sexual orientation and gender identity or expression", group: "law", aka: ["lgbt", "lgbti", "lgbtq", "sogi", "sexual orientation"],
    def: "The heading the Home Office uses for notes on claims based on a person’s sexual orientation, gender identity or gender expression. The wording of the title varies from note to note; this site lists them together." },
  { id: "gbv", term: "GBV", full: "Gender-based violence", group: "law", aka: ["gender based violence", "violence against women"],
    def: "Violence directed at a person because of their gender, or that affects one gender disproportionately. Notes on ‘women fearing gender-based violence’ cover it." },
  { id: "fgm", term: "FGM", full: "Female genital mutilation", group: "law", aka: ["female genital mutilation", "cutting"],
    def: "The cutting or removal of female genitalia for non-medical reasons. Some countries have a note on the risk of it." },
  { id: "ocg", term: "OCG", full: "Organised criminal group", group: "law", aka: ["ocgs", "organised crime", "gangs"],
    def: "A structured criminal group, such as a gang or cartel. Notes on gangs and organised criminal groups cover the risk from them and the protection available." },

  { id: "modern-slavery", term: "Modern slavery and trafficking", full: "NRM", group: "law", aka: ["nrm", "national referral mechanism", "human trafficking", "trafficking", "modern slavery"],
    def: "Trafficking is recruiting, moving or holding a person in order to exploit them. Modern slavery is the wider term the Home Office now uses, covering trafficking, slavery and forced labour. The National Referral Mechanism (NRM) is the UK’s system for identifying victims." },
  { id: "uasc", term: "Unaccompanied children", full: "UASC", group: "law", aka: ["uasc", "unaccompanied asylum-seeking children", "unaccompanied minors"],
    def: "Children under 18 who claim asylum with no parent or guardian to care for them, often called unaccompanied asylum-seeking children. Some countries have a note on what awaits a child who is returned." },

  // ---- this site ------------------------------------------------------------------------------
  { id: "edition", term: "Edition", group: "site", aka: ["editions"],
    def: "One copy of a report as it stood at one time. This site keeps every edition it has seen, so a report has a history. An edition usually matches a Home Office version, but a note can change without a new version number." },
  { id: "verbatim", term: "Verbatim", group: "site", aka: ["word for word", "exact"],
    def: "Word for word. The text of every edition here is exactly as published; nothing is summarised or reworded. Only the layout is this site’s." },
  { id: "archived-copy", term: "Archived copy", group: "site", aka: ["internet archive", "wayback", "wayback machine", "archive"],
    def: "An earlier edition recovered from the Internet Archive, the National Archives or a document repository, because GOV.UK does not keep old editions. The source is linked and an archive capture date is given where one is known. Where the copy is a PDF, its text is read from that PDF and is marked ‘From the PDF’ as well." },
  { id: "latest-and-earlier", term: "Latest and earlier editions", group: "site", aka: ["latest", "latest guidance", "earlier edition", "not current guidance", "last edition"],
    def: "‘Latest’ marks the edition now on GOV.UK: the current guidance. An earlier edition has been replaced and is not current guidance, however recent it looks. ‘Latest guidance’ goes back to the current one." },
  { id: "as-at", term: "As at", group: "site", aka: ["timeline", "history", "play history", "old and new"],
    def: "The date the history timeline is showing: the report as it stood on that day. When two editions are compared, ‘Old’ and ‘New’ mark which is which." },
  { id: "report-status", term: "Archived and removed reports", group: "site", aka: ["archived copy only", "removed from gov.uk", "removed", "withdrawn", "no longer on gov.uk"],
    def: "A report marked ‘Removed from GOV.UK’ was copied here while it was live and has since been withdrawn. One marked ‘Archived copy only’ was recovered from an archive or document repository after it had gone. Neither is current guidance." },
  { id: "pdf-only", term: "PDF only", group: "site", aka: ["pdf"],
    def: "A report published only as a PDF, with no web-page edition. Where its text can be extracted, this site lays it out for reading and comparison, marked ‘From the PDF’ and linked to the original file. Current reports are searchable too." },
  { id: "govuk-notice", term: "GOV.UK notice", group: "site", aka: ["notice"],
    def: "A page GOV.UK published among a country’s notes that is not a report, such as a statement that the notes had been removed for review. It is kept as part of the record." },
  { id: "not-held", term: "Not held", group: "site", aka: ["missing edition"],
    def: "GOV.UK recorded an update, but no copy of that edition was captured, so its text cannot be shown. The timeline still marks the date." },
  { id: "govuk-update", term: "GOV.UK update", group: "site", aka: ["change note", "change history", "updates"],
    def: "An entry in the change history GOV.UK keeps for each country’s page, quoted here word for word. It covers the whole country page, not one report." },
  { id: "show-changes", term: "Show changes", full: "Redline", group: "site", aka: ["redline", "compare", "comparison", "diff", "track changes", "side by side"],
    def: "A comparison of two editions of a report: words added are underlined and words removed are struck through. It can be read in line or with the two editions side by side." },
  { id: "rewritten", term: "Rewritten", group: "site", aka: ["rewrite"],
    def: "An edition that keeps under a quarter of the wording of the one before. A comparison would mark almost everything, so the two editions are offered side by side instead. The figure is computed by this site." },
  { id: "computed", term: "Computed", group: "site", aka: ["calculated"],
    def: "A label for anything this site worked out itself (word counts, which sections changed most), to keep it apart from the Home Office’s own words." },
  { id: "sources", term: "Sources and dead links", group: "site", aka: ["dead link", "dead links", "link check", "moved link", "broken link", "cant verify", "not checked", "link status"],
    def: "The notes cite thousands of web pages. This site checks whether each link still works, marks dead and moved ones, offers an archived copy where the Internet Archive has one, and says so when a link could not be verified (a login, a paywall, or a site that refuses automatic checks)." },
  { id: "highlight", term: "Saved highlight", group: "site", aka: ["highlight", "highlights", "saved"],
    def: "A passage you select and save. It is kept in this browser with its paragraph number, the sources it cites and a citation to the edition you read it in. Saved highlights can be exported to Word." },
  { id: "citation-styles", term: "Citation styles", full: "Full (OSCOLA) and Short (tribunal)", group: "site", aka: ["oscola", "citation", "cite", "tribunal citation", "short citation"],
    def: "Two ways to cite a passage. Full follows OSCOLA, the standard for legal citation in the UK: author, title, version and date, paragraph, web address and the date you read it. Short is the compact form used in tribunal decisions and skeleton arguments." },
  { id: "accurate-as-of", term: "Accurate as of", group: "site", aka: ["up to date", "check for changes", "last checked"],
    def: "When this site last confirmed that GOV.UK has published nothing newer. It compares the dates GOV.UK gives for each country page; a weekly sync is scheduled to re-read the text of every note in full." },
  { id: "ogl", term: "Open Government Licence", full: "OGL", group: "site", aka: ["ogl", "licence", "copyright", "crown copyright"],
    def: "The licence under which the Home Office publishes the notes, which allows them to be copied and republished with acknowledgement. The notes are Crown copyright; this site is an independent mirror, not a Home Office service." },
];

/** Lower case, no accents or punctuation, single spaces. */
export const normTerm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const byId = new Map(GLOSSARY.map((e) => [e.id, e]));
/** One entry by id, or null. */
export const glossaryEntry = (id) => byId.get(id) || null;
/** Where an entry lives on the guide page. */
export const glossaryHref = (id, base = "../guide/index.html") => `${base}#term-${id}`;

const startsWord = (hay, word) => ` ${hay}`.includes(` ${word}`);
const names = (e) => [e.term, e.full || "", ...(e.aka || [])].map(normTerm).filter(Boolean);

/**
 * Entries matching a query, best first. By default only names are searched (the term, what it stands
 * for, and other words for it), every query word starting a word of one name: right for the site's
 * search, where a definition that happens to contain "government" must not be a result. With
 * `definitions`, entries whose explanation contains all the words follow (the glossary's own filter).
 */
export function searchGlossary(query, { limit = Infinity, definitions = false } = {}) {
  const words = normTerm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const q = words.join(" ");
  const scored = [];
  for (const e of GLOSSARY) {
    const ns = names(e);
    let score = 0;
    if (ns.includes(q)) score = 3;                                             // the term itself, or a name for it
    else if (ns.some((n) => words.every((w) => startsWord(n, w)))) score = 2;  // every word starts a word of one name
    else if (definitions && words.every((w) => startsWord(normTerm(e.def), w))) score = 1;
    if (score) scored.push({ e, score });
  }
  return scored.sort((a, z) => z.score - a.score).slice(0, limit).map((x) => x.e);
}
