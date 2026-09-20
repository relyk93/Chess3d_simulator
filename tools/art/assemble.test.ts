// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ALL_PIECE_KEYS } from '../../src/packs/types';
import { parseSetManifest } from '../../src/packs/validate';
import { AssembleError, assemble } from './assemble';
import { buildSet } from './buildSet';
import { defaultDesign, type Design } from './design';
import { Jobs, type StageKey } from './jobs';
import { CLIP_NAMES } from './spec';
import { statueGlb } from './testing/fixtures';

const isRigged = (key: string) => /-(king|queen|bishop|knight)$/.test(key);

function put(dir: string, rel: string, data: Uint8Array | string) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), data);
}

/** A finished project: every result downloaded, recorded in jobs.json, with real (tiny) glb files. */
async function finishedProject(edit: (design: Design) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
  const design = defaultDesign();
  design.actions = { idle: 1, attack: 4, hit: 2, die: 3, victory: 5 };
  edit(design);
  writeFileSync(join(dir, 'design.json'), JSON.stringify(design));
  const jobs = Jobs.load(join(dir, 'jobs.json'));
  const record = (piece: string, stage: StageKey, file: string) =>
    jobs.add(piece, stage, { taskId: `${piece}-${stage}`, status: 'SUCCEEDED', file, credits: 1, error: null });

  for (const key of ALL_PIECE_KEYS) {
    if (isRigged(key)) {
      const rig = `rigged/${key}-1.glb`;
      put(dir, rig, await statueGlb({ skinned: true, size: [0.5, 3, 0.5], center: [2, 4, 0], clips: ['Walking', 'Running'] }));
      record(key, 'rig', rig);
      for (const clip of CLIP_NAMES) {
        const file = `anims/${key}/${clip}-1.glb`;
        put(dir, file, await statueGlb({ skinned: true, clips: ['Motion'] }));
        record(key, clip, file);
      }
    } else {
      const model = `models/${key}-1.glb`;
      put(dir, model, await statueGlb({ size: [0.5, 1, 0.5], center: [0, 0.5, 0] }));
      record(key, 'model', model);
    }
  }
  return { dir, jobs, design };
}

describe('assemble', () => {
  test('writes a set.json with the rig, the five clip files and the base-clip drop for each rigged piece', async () => {
    const { dir } = await finishedProject();
    const set = assemble(dir);
    expect(JSON.parse(readFileSync(join(dir, 'set.json'), 'utf8'))).toEqual(set);
    expect(set).toMatchObject({ id: 'angels-vs-demons', name: 'Angels vs Demons', version: 2 });
    expect(set.pieces['w-king']).toEqual({
      model: 'rigged/w-king-1.glb',
      keep: ['idle', 'attack', 'hit', 'die', 'victory'],
      dropBaseClips: true,
      clips: {
        idle: 'anims/w-king/idle-1.glb',
        attack: 'anims/w-king/attack-1.glb',
        hit: 'anims/w-king/hit-1.glb',
        die: 'anims/w-king/die-1.glb',
        victory: 'anims/w-king/victory-1.glb',
      },
    });
  });

  test('a rigid piece uses its model and carries no clips', async () => {
    const { dir } = await finishedProject();
    expect(assemble(dir).pieces['b-rook']).toEqual({ model: 'models/b-rook-1.glb' });
  });

  test('uses the attempt that was picked, not just the latest', async () => {
    const { dir, jobs } = await finishedProject();
    put(dir, 'rigged/w-king-2.glb', 'newer');
    jobs.add('w-king', 'rig', { taskId: 'w-king-rig-2', status: 'SUCCEEDED', file: 'rigged/w-king-2.glb', credits: 5, error: null });
    expect(assemble(dir).pieces['w-king']!.model).toBe('rigged/w-king-2.glb');
    jobs.select('w-king', 'rig', 1);
    expect(assemble(dir).pieces['w-king']!.model).toBe('rigged/w-king-1.glb');
  });

  test('passes rotateY and audio through from the design', async () => {
    const { dir } = await finishedProject((d) => {
      d.pieces['w-knight']!.rotateY = 180;
      d.audio = { attack: 'audio/attack.wav' };
    });
    put(dir, 'audio/attack.wav', 'RIFF');
    const set = assemble(dir);
    expect(set.pieces['w-knight']!.rotateY).toBe(180);
    expect(set.pieces['w-king']).not.toHaveProperty('rotateY');
    expect(set.audio).toEqual({ attack: 'audio/attack.wav' });
  });

  test('builds into a real pack through buildSet, end to end', async () => {
    const { dir } = await finishedProject();
    assemble(dir);
    const out = join(mkdtempSync(join(tmpdir(), 'assemble-out-')), 'set');
    const reports = await buildSet(dir, out);
    expect(reports).toHaveLength(12);
    const manifest = parseSetManifest(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
    for (const key of ALL_PIECE_KEYS) {
      expect(manifest.pieces[key]!.clips).toEqual(isRigged(key) ? ['idle', 'attack', 'hit', 'die', 'victory'] : []);
    }
    expect(reports.find((r) => r.piece === 'w-king')!.heightUnits).toBeCloseTo(1, 3);
    expect(reports.find((r) => r.piece === 'b-pawn')!.heightUnits).toBeCloseTo(0.55, 3);
  });
});

describe('assemble problems', () => {
  test('lists every missing result at once and writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
    const design = defaultDesign();
    design.actions = { idle: 1, attack: 4, hit: 2, die: 3, victory: 5 };
    writeFileSync(join(dir, 'design.json'), JSON.stringify(design));
    const jobs = Jobs.load(join(dir, 'jobs.json'));
    put(dir, 'rigged/w-king-1.glb', 'x');
    jobs.add('w-king', 'rig', { taskId: 'r', status: 'SUCCEEDED', file: 'rigged/w-king-1.glb', credits: 5, error: null });

    const error = (() => { try { assemble(dir); } catch (e) { return e as AssembleError; } })();
    expect(error).toBeInstanceOf(AssembleError);
    const message = error!.message;
    expect(message).toMatch(/cannot assemble: \d+ problems/);
    expect(message).toMatch(/w-king idle: no animation yet; run --stage animate/);
    expect(message).toMatch(/w-queen rig: no rig yet; run --stage rig/);
    expect(message).toMatch(/w-rook model: no model yet; run --stage model/);
    expect(message).toMatch(/b-pawn model: no model yet/);
    expect(existsSync(join(dir, 'set.json'))).toBe(false);
  });

  test('a result recorded in jobs.json but missing on disk is reported', async () => {
    const { dir } = await finishedProject();
    // a record that points at a file that was never downloaded, or was deleted
    const jobs = Jobs.load(join(dir, 'jobs.json'));
    jobs.add('w-queen', 'rig', { taskId: 'gone', status: 'SUCCEEDED', file: 'rigged/w-queen-9.glb', credits: 5, error: null });
    expect(() => assemble(dir)).toThrow(/w-queen rig: file rigged\/w-queen-9\.glb is missing on disk/);
  });

  test('an audio file named in the design but absent is reported', async () => {
    const { dir } = await finishedProject((d) => (d.audio = { hit: 'audio/nope.wav' }));
    expect(() => assemble(dir)).toThrow(/audio hit: file audio\/nope\.wav is missing on disk/);
  });

  test('a missing design.json says how to create it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
    expect(() => assemble(dir)).toThrow(/design\.json: not found in .*init-set/);
  });
});
