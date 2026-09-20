// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiFromEnvironment, MissingKeyError } from './env';
import { MeshyClient } from './client';

const KEY = 'msy_ENV_KEY_9876';

describe('apiFromEnvironment', () => {
  const saved = process.env.MESHY_API_KEY;
  beforeEach(() => {
    delete process.env.MESHY_API_KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MESHY_API_KEY;
    else process.env.MESHY_API_KEY = saved;
  });

  test('says how to set the key when there is none', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    expect(() => apiFromEnvironment(missing)).toThrow(MissingKeyError);
    expect(() => apiFromEnvironment(missing)).toThrow(/MESHY_API_KEY is not set; put MESHY_API_KEY=your_key in \.env/);
  });

  test('reads the key from a .env file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    writeFileSync(file, `MESHY_API_KEY=${KEY}\n`);
    expect(apiFromEnvironment(file)).toBeInstanceOf(MeshyClient);
  });

  test('an empty or blank key counts as not set', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    writeFileSync(file, 'MESHY_API_KEY=   \n');
    expect(() => apiFromEnvironment(file)).toThrow(/is not set/);
  });

  test('a real environment variable wins over the file, and the key is never in an error message', () => {
    process.env.MESHY_API_KEY = KEY;
    const file = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    writeFileSync(file, 'MESHY_API_KEY=from_file\n');
    expect(apiFromEnvironment(file)).toBeInstanceOf(MeshyClient);
    delete process.env.MESHY_API_KEY;
    try {
      apiFromEnvironment(join(tmpdir(), 'no-such-env-file'));
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY);
    }
  });
});
