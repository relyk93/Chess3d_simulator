// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ALL_PIECE_KEYS } from '../../src/packs/types';
import { parseSetManifest } from '../../src/packs/validate';
import { buildSet } from './buildSet';
import { statueGlb } from './testing/fixtures';

const FIVE = ['idle', 'attack', 'hit', 'die', 'victory'] as const;
const isRigged = (key: string) => ['king', 'queen', 'bishop', 'knight'].some((n) => key.endsWith(`-${n}`));

const put = (root: string, rel: string, data: Uint8Array | string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), data);
};

async function makeSource(brokenPiece?: string): Promise<string> {
  const src = mkdtempSync(join(tmpdir(), 'art-src-'));
  const pieces: Record<string, unknown> = {};
  for (const key of ALL_PIECE_KEYS) {
    const rigged = isRigged(key);
    const broken = key === brokenPiece;
    put(
      src,
      `raw/${key}.glb`,
      await statueGlb({
        skinned: rigged,
        size: broken ? [0.4, 0.4, 2] : [0.5, 3, 0.5],
        center: broken ? [0, 0, 1] : [2, 4, 0],
        clips: rigged ? FIVE.map((c) => `Rig|${c}`) : ['idle'],
      }),
    );
    pieces[key] = rigged
      ? { model: `raw/${key}.glb`, keep: [...FIVE], rename: Object.fromEntries(FIVE.map((c) => [`Rig|${c}`, c])) }
      : { model: `raw/${key}.glb` };
  }
  put(src, 'sfx/attack.wav', 'RIFFxxxxWAVE');
  put(
    src,
    'set.json',
    JSON.stringify({
      id: 'test-set',
      name: 'Test Set',
      version: 2,
      sides: {
        w: { name: 'Light', color: '#ffffff', impactEffect: 'light' },
        b: { name: 'Dark', color: '#000000', impactEffect: 'fire' },
      },
      audio: { attack: 'sfx/attack.wav' },
      pieces,
    }),
  );
  return src;
}

function editConfig(src: string, edit: (config: any) => void) {
  const path = join(src, 'set.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  edit(config);
  writeFileSync(path, JSON.stringify(config));
}

const outDir = () => join(mkdtempSync(join(tmpdir(), 'art-out-')), 'set');

describe('buildSet', () => {
  test('builds twelve models, copies audio and writes a valid stamped manifest', async () => {
    const out = outDir();
    const reports = await buildSet(await makeSource(), out);

    expect(reports).toHaveLength(12);
    const raw = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(raw.generator).toBe('art-pipeline');
    const manifest = parseSetManifest(raw);
    expect(manifest).toMatchObject({ id: 'test-set', name: 'Test Set', version: 2 });
    expect(manifest.pieces['w-king']).toEqual({ model: 'models/w-king.glb', clips: [...FIVE] });
    expect(manifest.pieces['b-knight']?.clips).toEqual([...FIVE]);
    expect(manifest.pieces['w-pawn']).toEqual({ model: 'models/w-pawn.glb', clips: [] });
    expect(manifest.audio).toEqual({ attack: 'audio/attack.wav' });

    for (const key of ALL_PIECE_KEYS) {
      expect(statSync(join(out, 'models', `${key}.glb`)).size).toBeLessThan(2 * 1024 * 1024);
    }
    expect(readFileSync(join(out, 'audio', 'attack.wav'), 'utf8')).toBe('RIFFxxxxWAVE');
  });

  test('a missing piece is an error and no manifest is written', async () => {
    const src = await makeSource();
    editConfig(src, (c) => delete c.pieces['b-pawn']);
    const out = outDir();
    await expect(buildSet(src, out)).rejects.toThrow(/set\.json: missing pieces: b-pawn/);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
  });

  test('an unknown piece key is an error', async () => {
    const src = await makeSource();
    editConfig(src, (c) => (c.pieces['w-dragon'] = { model: 'raw/w-king.glb' }));
    await expect(buildSet(src, outDir())).rejects.toThrow(/set\.json: unknown pieces: w-dragon/);
  });

  test('a bad model stops the build with its piece key and writes no manifest', async () => {
    const out = outDir();
    await expect(buildSet(await makeSource('w-pawn'), out)).rejects.toThrow(/^w-pawn: does not look Y-up/);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
  });

  test('an invalid manifest field is caught before the manifest is written', async () => {
    const src = await makeSource();
    editConfig(src, (c) => (c.sides.w.color = 'red'));
    const out = outDir();
    await expect(buildSet(src, out)).rejects.toThrow(/Invalid manifest at sides\.w\.color/);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
  });

  test('dropBaseClips discards the base model clips without needing a rename map', async () => {
    const src = await makeSource();
    put(src, 'raw/w-king-die.glb', await statueGlb({ skinned: true, clips: ['Death'] }));
    editConfig(src, (c) => {
      c.pieces['w-king'] = { model: 'raw/w-king.glb', keep: ['die'], dropBaseClips: true, clips: { die: 'raw/w-king-die.glb' } };
    });
    const out = outDir();
    await buildSet(src, out);
    expect(parseSetManifest(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).pieces['w-king']?.clips).toEqual(['die']);
  });

  test('per-piece clips files are merged', async () => {
    const src = await makeSource();
    put(src, 'raw/w-king-die.glb', await statueGlb({ skinned: true, clips: ['Death'] }));
    editConfig(src, (c) => {
      c.pieces['w-king'] = {
        model: 'raw/w-king.glb',
        keep: ['die'],
        rename: { 'Rig|idle': null, 'Rig|attack': null, 'Rig|hit': null, 'Rig|die': null, 'Rig|victory': null },
        clips: { die: 'raw/w-king-die.glb' },
      };
    });
    const out = outDir();
    await buildSet(src, out);
    expect(parseSetManifest(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).pieces['w-king']?.clips).toEqual(['die']);
  });
});
