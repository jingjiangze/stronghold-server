// The match settings shipped for local play (packages/server/matches, `main.js --match <file>`): each is valid settings
// (engine spec 同步-9), names a playable level whose code is the file's name, and makes its content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchProblem } from '@aue/schema';
import { matchContent } from '@aue/content';

const DIR = fileURLToPath(new URL('../matches/', import.meta.url));

test('every shipped match file is valid settings for a playable level named by the file (engine spec 同步-9)', async () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, ['ig-1.json', 'ig-10.json', 'ig-s-2.json']);
  for (const f of files) {
    const match = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    assert.equal(matchProblem(match), null, f);
    const c = await matchContent(match);
    assert.equal(/** @type {any} */ (c.level).code.toLowerCase(), f.replace(/\.json$/, ''), f);
    assert.equal(c.decks?.length, 2, f);
  }
});
