import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceUrlAllowed } from '../../prototypes/shared/note-source.js';

test('stored source links cannot execute a scheme split by HTML control characters', () => {
  for (const url of ['javascript:alert(1)', 'java\nscript:alert(1)', '\tJaVa\tsCrIpT:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) assert.equal(sourceUrlAllowed(url), false, url);
  for (const url of ['https://www.gov.uk/page', 'https://example.org/javascript:article', '#fn:1',
    '/government/publications/note', 'mailto:cpin@homeoffice.gov.uk']) assert.equal(sourceUrlAllowed(url), true, url);
});
