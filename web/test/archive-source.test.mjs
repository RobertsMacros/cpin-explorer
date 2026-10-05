import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveName } from '../../prototypes/shared/archive-source.js';
import { capturedAt, editionWhere } from '../../prototypes/shared/report-history.js';
import { formatCitation } from '../../prototypes/shared/citation.js';

test('National Archives citations use the saved capture date and actual archive name', () => {
  const url = 'https://webarchive.nationalarchives.gov.uk/ukgwa/20170203203616/https://www.gov.uk/old.pdf';
  const edition = { source: 'pdf', archive_url: url, captured_at: '2026-01-01T00:00:00Z' };
  const where = editionWhere(edition);
  assert.equal(archiveName(edition), 'National Archives');
  assert.equal(where.capturedAt, '2017-02-03T20:36:16Z');
  const citation = formatCitation({ title: 'Country information and guidance: Hindus and Sikhs, Afghanistan, January 2016',
    countryName: 'Afghanistan', source: 'pdf', archived: true, url, capturedAt: where.capturedAt }, 'oscola');
  assert.match(citation.text, /archived copy, National Archives, captured 3 February 2017/);
  assert.doesNotMatch(citation.text, /Internet Archive/);
  assert.equal(citation.url, url);
});

test('repository copies are named correctly and have no invented capture date', () => {
  const url = 'https://www.ecoi.net/en/file/local/1435872/note.pdf';
  const where = editionWhere({ source: 'pdf', archive_url: url });
  assert.equal(where.capturedAt, null);
  const citation = formatCitation({ title: 'Country policy and information note: Ahmadis, Pakistan, June 2018',
    countryName: 'Pakistan', source: 'pdf', archived: true, url }, 'tribunal');
  assert.match(citation.text, /archived copy, ecoi.net/);
  assert.doesNotMatch(citation.text, /captured|Internet Archive/);
});
