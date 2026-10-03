import assert from "node:assert/strict";
import { test } from "node:test";
import { auditGroups, normTopic, topicGroups, topicLabel } from "../../prototypes/shared/topic-groups.js";

const labels = (topic) => topicGroups(topic).map((g) => g.label);
const row = (topic, label) => topicGroups(topic).find((g) => g.label === label)?.qualifier;

test("a place in the title does not make a new subject (the owner's rule)", () => {
  assert.deepEqual(labels("humanitarian situation in Gaza"), ["Humanitarian situation"]);
  assert.equal(row("humanitarian situation in Gaza", "Humanitarian situation"), "Gaza");
  assert.equal(row("humanitarian situation in Mogadishu", "Humanitarian situation"), "Mogadishu");
  assert.equal(row("security situation in Gaza", "Security situation"), "Gaza");
  assert.equal(row("humanitarian situation", "Humanitarian situation"), "");
});

test("a combined report sits in both lists and says what it is", () => {
  const t = "security and humanitarian situation in Mogadishu";
  assert.deepEqual(labels(t).sort(), ["Humanitarian situation", "Security situation"]);
  assert.equal(row(t, "Humanitarian situation"), "Security and humanitarian situation in Mogadishu");
  assert.deepEqual(labels("Mogadishu: Al Shabab and the security situation"), ["Security situation"]);
});

test("the same subject in other words is one group, with no label on the row", () => {
  for (const t of ["sexual orientation and gender", "sexual orientation and gender identity", "sexual orientation and gender identity / expression",
    "sexual orientation and gender identity and expression", "Sexual orientation and gender identity or expression",
    "sexual orientation, gender identity and expression", "Sexual orientation and gender identity and expression in"]) {   // "… in" is how Namibia's title parses
    assert.deepEqual(topicGroups(t), [{ key: "sexual-orientation-and-gender-identity-or-expression", label: "Sexual orientation and gender identity or expression", qualifier: "" }], t);
  }
  for (const t of ["healthcare and medical treatment", "medical and healthcare issues", "medical and healthcare provision", "medical treatment and healthcare"]) {
    assert.deepEqual(labels(t), ["Medical treatment and healthcare"], t);
  }
  assert.deepEqual(labels("fear of gangs"), ["Gangs and organised criminal groups"]);
  assert.deepEqual(labels("trafficking"), ["Human trafficking"]);
  assert.deepEqual(labels("political affiliation"), ["Political parties and affiliation"]);
  assert.deepEqual(labels("gender-based violence"), ["Women fearing gender-based violence"]);
  assert.deepEqual(labels("Organised criminal groups"), ["Gangs and organised criminal groups"]);
});

test("a report with a different scope joins the list but keeps its own title on the row", () => {
  assert.equal(row("internal relocation, civil documentation and returns", "Internal relocation"), "Internal relocation, civil documentation and returns");
  assert.equal(row("religious minorities (excluding Alawites)", "Religious minorities"), "Excluding Alawites");
  assert.equal(row("Muslims (including Uyghurs in Xinjiang)", "Muslims"), "Including Uyghurs in Xinjiang");
  assert.equal(row("trafficking of women", "Human trafficking"), "Trafficking of women");
  assert.equal(row("Iraq Blood feuds, honour crimes and tribal violence", "Blood feuds"), "Blood feuds, honour crimes and tribal violence");
  assert.equal(row("opposition to the government in the Kurdistan Region of Iraq (KRI)", "Opposition to the state or government"), "Kurdistan Region of Iraq (KRI)");
  assert.equal(row("Tigrayans and the Tigrayan People’s Liberation Front", "Tigrayans"), "Tigrayans and the Tigrayan People’s Liberation Front");
});

test("case, quotes and spacing never split a group", () => {
  assert.deepEqual(topicGroups("Actors of protection"), topicGroups("actors  of protection"));
  assert.equal(topicGroups("Actors of protection")[0].label, "Actors of protection");
  assert.equal(normTopic("Tigrayans and the Tigrayan People’s Liberation Front"), normTopic("tigrayans and the tigrayan people's liberation front"));
  assert.deepEqual(labels("Military service"), labels("military service"));
});

test("the owner's five merges (3 Oct 2026)", () => {
  const OPP = "Opposition to the state or government", GANGS = "Gangs and organised criminal groups";
  for (const t of ["opposition to the state", "opposition to the government", "critics and opponents of the government", "criticism of the government"]) {
    assert.deepEqual(topicGroups(t), [{ key: "opposition-to-the-state-or-government", label: OPP, qualifier: "" }], t);
  }
  assert.equal(row("critics of the military regime", OPP), "Critics of the military regime");
  assert.equal(row("critics of the state, Chechnya", OPP), "Chechnya");
  for (const t of ["gangs", "fear of gangs", "Organised criminal groups", "Organised criminal groups (OCGs)", "fear of organised criminal groups (OCGs)"]) {
    assert.deepEqual(topicGroups(t), [{ key: "gangs-and-organised-criminal-groups", label: GANGS, qualifier: "" }], t);
  }
  assert.equal(row("armed groups and criminal gangs", GANGS), "Armed groups and criminal gangs");
  assert.equal(row("modern slavery", "Human trafficking"), "Modern slavery");
  assert.equal(row("unsuccessful asylum seekers", "Returnees"), "Unsuccessful asylum seekers");
  assert.deepEqual(labels("national service and illegal exit").sort(), ["Illegal exit", "Military service"]);
  assert.equal(row("national service and illegal exit", "Military service"), "National service and illegal exit");
  assert.deepEqual(topicGroups("Military service"), [{ key: "military-service", label: "Military service", qualifier: "" }]);
});

test("lookalikes stay apart: no false positives", () => {
  const apart = [
    ["mental healthcare", "medical treatment and healthcare"],
    ["children", "unaccompanied children"],
    ["women", "women fearing gender-based violence"],
    ["women fearing ‘honour’ based violence", "women fearing gender-based violence"],
    ["women - early and forced marriage", "women fearing gender-based violence"],
    ["female genital mutilation (FGM)", "women fearing gender-based violence"],
    ["political situation", "political parties and affiliation"],
    ["non-Christian religious groups", "religious minorities"],
    ["ethnic and religious groups", "religious minorities"],
    ["Documentation", "internal relocation, civil documentation and returns"],
    ["political situation", "opposition to the state"],
    ["perceived collaborators", "opposition to the state"],
    ["fear of the Taliban", "gangs"],
    ["fear of illegal moneylenders", "gangs"],
    ["Islamist extremist groups in North East", "armed groups and criminal gangs"],
    ["separatist groups in the South-East", "armed groups and criminal gangs"],
    ["PKK", "Kurds"],
    ["Peoples' Democratic Party (HDP)", "political parties and affiliation"],
    ["sufficiency of protection", "actors of protection"],
    ["safe third country", "internal relocation"],
  ];
  for (const [a, b] of apart) {
    const A = new Set(topicGroups(a).map((g) => g.key)), B = topicGroups(b).map((g) => g.key);
    assert.ok(!B.some((k) => A.has(k)), `${a} must not share a group with ${b}`);
  }
});

test("an 'in <place>' that is part of the subject is left alone", () => {
  assert.deepEqual(topicGroups("Palestinians in Lebanon"), [{ key: "palestinians-in-lebanon", label: "Palestinians in Lebanon", qualifier: "" }]);
  assert.equal(topicGroups("Islamist extremist groups in North East")[0].label, "Islamist extremist groups in North East");
  assert.equal(topicGroups("separatist groups in the South-East")[0].label, "Separatist groups in the South-East");
  assert.equal(topicGroups("Rohingya including Rohingya in Bangladesh")[0].qualifier, "");
});

test("an unseen title only joins a group as 'listed topic + place' or '+ bracketed note'", () => {
  assert.deepEqual(topicGroups("security situation in Hodeidah"), [{ key: "security-situation", label: "Security situation", qualifier: "Hodeidah" }]);
  assert.deepEqual(topicGroups("returnees (2027 update)"), [{ key: "returnees", label: "Returnees", qualifier: "2027 update" }]);
  assert.equal(topicGroups("security forces")[0].label, "Security forces");                    // shares a word, nothing more
  assert.equal(topicGroups("humanitarian workers in Gaza")[0].label, "Humanitarian workers in Gaza");
  assert.equal(topicGroups("women in Kabul")[0].key, "women-in-kabul");                           // "women" is not a listed group
});

test("a GOV.UK notice is not grouped with anything", () => {
  const g = topicGroups("All Albania country policy and information notes have been removed for review");
  assert.equal(g.length, 1);
  assert.equal(g[0].qualifier, "");
});

test("auditGroups lists each group with the distinct topics in it", () => {
  const audit = auditGroups(["humanitarian situation", "Humanitarian situation", "humanitarian situation in Gaza", "PKK"]);
  assert.deepEqual([...audit.get("humanitarian-situation").topics.keys()], ["humanitarian situation", "humanitarian situation in gaza"]);
  assert.equal(audit.get("pkk").label, "PKK");
});

test("topicLabel is the report's own wording, tidied, for rows that matched on it", () => {
  assert.equal(topicLabel("critics and opponents of the government"), "Critics and opponents of the government");
  assert.equal(topicLabel("Iraq Blood feuds, honour crimes and tribal violence"), "Blood feuds, honour crimes and tribal violence");
  assert.equal(topicLabel("Sexual orientation and gender identity and expression in"), "Sexual orientation and gender identity and expression");
});
