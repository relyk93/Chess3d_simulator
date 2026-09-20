// @vitest-environment node
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Box3, Vector3, type AnimationClip, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { generateDevPacks } from './generate';
import { PIECE_HEIGHT, PIECE_NAMES, RIGGED, type Color, type PieceType } from './pieces';

const dir = mkdtempSync(join(tmpdir(), 'devpack-'));
const written = generateDevPacks(dir);

function loadGlb(rel: string): Promise<{ scene: Group; animations: AnimationClip[] }> {
  const bytes = readFileSync(join(dir, rel));
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', (g) => res(g), rej));
}

const ALL: [Color, PieceType][] = (['w', 'b'] as Color[]).flatMap((c) => (['k', 'q', 'r', 'b', 'n', 'p'] as PieceType[]).map((t) => [c, t] as [Color, PieceType]));

describe('dev pack piece models (spec 5.2 conventions)', () => {
  test.each(ALL)('%s-%s: feet at y=0, centered, exact height, under 2 MB, clips named per spec', async (c, t) => {
    const rel = `packs/sets/angels-vs-demons/models/${c}-${PIECE_NAMES[t]}.glb`;
    expect(statSync(join(dir, rel)).size).toBeLessThan(2 * 1024 * 1024);
    const { scene, animations } = await loadGlb(rel);
    const box = new Box3().setFromObject(scene);
    const center = box.getCenter(new Vector3());
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(PIECE_HEIGHT[t], 3);
    expect(Math.abs(center.x)).toBeLessThan(0.02);
    expect(Math.abs(center.z)).toBeLessThan(0.05);
    const names = animations.map((a) => a.name).sort();
    expect(names).toEqual(RIGGED.includes(t) ? ['attack', 'die', 'hit', 'idle', 'victory'] : []);
  });

  test('idle loops cleanly (first and last keyframe match)', async () => {
    const { animations } = await loadGlb('packs/sets/angels-vs-demons/models/w-king.glb');
    const idle = animations.find((a) => a.name === 'idle')!;
    const track = idle.tracks[0]!;
    const n = track.values.length;
    expect(Array.from(track.values.slice(0, 4))).toEqual(Array.from(track.values.slice(n - 4)));
  });
});

describe('dev pack board and environment', () => {
  test('board.glb has slab, frame and a cracks mesh under the squares', async () => {
    const { scene } = await loadGlb('packs/boards/stone-lava/board.glb');
    const names: string[] = [];
    scene.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) names.push(o.name); });
    expect(names.sort()).toEqual(['cracks', 'frame', 'slab']);
    const box = new Box3().setFromObject(scene);
    expect(box.min.y).toBeCloseTo(-0.3, 3);
    expect(box.max.x).toBeCloseTo(4.5, 3);
  });

  test('env.hdr parses with HDRLoader', () => {
    const bytes = readFileSync(join(dir, 'packs/boards/stone-lava/env.hdr'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const tex = new HDRLoader().parse(ab);
    expect(tex.width).toBe(64);
    expect(tex.height).toBe(32);
    expect(tex.data?.length).toBeGreaterThan(0);
  });
});

describe('dev pack audio and manifests', () => {
  test('wav files have a valid RIFF header', () => {
    for (const n of ['attack', 'hit', 'die']) {
      const b = readFileSync(join(dir, `packs/sets/angels-vs-demons/audio/${n}.wav`));
      expect(b.subarray(0, 4).toString()).toBe('RIFF');
      expect(b.subarray(8, 12).toString()).toBe('WAVE');
      expect(b.readUInt32LE(4) + 8).toBe(b.length);
    }
  });

  test('writes 12 models, 3 sounds, 2 manifests, board glb and hdr', () => {
    expect(written).toHaveLength(12 + 3 + 1 + 3);
  });
});
