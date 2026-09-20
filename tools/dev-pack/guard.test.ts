// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDevPacks } from './generate';

const SET = 'packs/sets/angels-vs-demons/manifest.json';
const BOARD = 'packs/boards/stone-lava/manifest.json';

function stamp(dir: string, rel: string) {
  const path = join(dir, rel);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), generator: 'art-pipeline' }));
  return path;
}

describe('dev-pack generator guard', () => {
  test('regenerating over a dev pack is allowed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    generateDevPacks(dir);
    expect(() => generateDevPacks(dir)).not.toThrow();
  });

  test.each([SET, BOARD])('refuses to overwrite an art-pipeline pack (%s) and leaves it untouched', (rel) => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    generateDevPacks(dir);
    const path = stamp(dir, rel);
    const before = readFileSync(path, 'utf8');
    expect(() => generateDevPacks(dir)).toThrow(/refusing to overwrite the art-pipeline pack/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
