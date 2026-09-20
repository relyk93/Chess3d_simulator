// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_PIECE_KEYS } from '../../src/packs/types';
import { formatReport, main, runNormalize } from './cli';
import { readGlb, statueGlb } from './testing/fixtures';

const names = async (path: string) =>
  (await readGlb(new Uint8Array(readFileSync(path)))).getRoot().listAnimations().map((a) => a.getName()).sort();

describe('runNormalize', () => {
  test('reads a file, writes the fixed model into a new folder and returns the report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-cli-'));
    writeFileSync(join(dir, 'raw.glb'), await statueGlb({ skinned: true, size: [0.5, 3, 0.5], center: [2, 5, 0], clips: ['Idle', 'Fight'] }));
    const out = join(dir, 'nested', 'out.glb');
    const report = await runNormalize([
      '--piece', 'w-queen', '--in', join(dir, 'raw.glb'), '--out', out,
      '--keep', 'idle,attack', '--rename', 'Idle=idle', '--rename', 'Fight=attack',
    ]);
    expect(report.clips).toEqual(['idle', 'attack']);
    expect(await names(out)).toEqual(['attack', 'idle']);
  });

  test('--anim merges a separate animation file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-cli-'));
    writeFileSync(join(dir, 'rig.glb'), await statueGlb({ skinned: true }));
    writeFileSync(join(dir, 'die.glb'), await statueGlb({ skinned: true, clips: ['Death'] }));
    const out = join(dir, 'out.glb');
    await runNormalize([
      '--piece', 'b-king', '--in', join(dir, 'rig.glb'), '--out', out,
      '--keep', 'die', '--anim', `die=${join(dir, 'die.glb')}`,
    ]);
    expect(await names(out)).toEqual(['die']);
  });
});

describe('formatReport', () => {
  test('lists height, size, clips and warnings', () => {
    const text = formatReport({ piece: 'w-king', heightUnits: 1, bytes: 51200, clips: ['idle'], warnings: ['idle did not loop'] });
    expect(text).toBe('w-king: 1.000 units tall, 50 KB, clips: idle\n  warning: idle did not loop');
  });

  test('says so when a piece has no clips', () => {
    expect(formatReport({ piece: 'w-pawn', heightUnits: 0.55, bytes: 1024, clips: [], warnings: [] })).toContain('none (rigid fallback)');
  });
});

describe('main', () => {
  test('a NormalizeError prints its message and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-cli-'));
    writeFileSync(join(dir, 'z.glb'), await statueGlb({ size: [0.4, 0.4, 2], center: [0, 0, 1] }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['normalize', '--piece', 'w-pawn', '--in', join(dir, 'z.glb'), '--out', join(dir, 'o.glb')]);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^w-pawn: does not look Y-up/));
    error.mockRestore();
  });

  test('a usage mistake prints the message and the usage text and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['normalize', '--piece', 'w-king'])).toBe(1);
    expect(error).toHaveBeenCalledWith('--in is required');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage:'));
    error.mockRestore();
  });

  test('a missing input file prints one line instead of a stack trace and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['normalize', '--piece', 'w-king', '--in', '/no/such/dir/x.glb', '--out', '/tmp/never.glb']);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('cannot open /no/such/dir/x.glb: no such file or directory');
    error.mockRestore();
  });

  test('build-set without its two folders is a usage error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['build-set', 'only-one'])).toBe(1);
    expect(error).toHaveBeenCalledWith('build-set expects <source-dir> <out-dir>');
    error.mockRestore();
  });

  test('build-set builds a set from a source folder and prints one line per piece', async () => {
    const src = mkdtempSync(join(tmpdir(), 'art-cli-set-'));
    const pieces: Record<string, unknown> = {};
    for (const key of ALL_PIECE_KEYS) {
      writeFileSync(join(src, `${key}.glb`), await statueGlb({ size: [0.5, 1, 0.5], center: [0, 0.5, 0] }));
      pieces[key] = { model: `${key}.glb` };
    }
    writeFileSync(
      join(src, 'set.json'),
      JSON.stringify({
        id: 's', name: 'S', version: 1,
        sides: { w: { name: 'A', color: '#ffffff', impactEffect: 'light' }, b: { name: 'B', color: '#000000', impactEffect: 'fire' } },
        pieces,
      }),
    );
    const out = join(src, 'out');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['build-set', src, out])).toBe(0);
    expect(log).toHaveBeenCalledTimes(12);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^w-king: 1\.000 units tall/));
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).generator).toBe('art-pipeline');
    log.mockRestore();
  });

  test('an unknown command exits 1 with the usage text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['frobnicate'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage:'));
    error.mockRestore();
  });
});
