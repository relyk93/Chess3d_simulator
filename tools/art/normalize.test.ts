// @vitest-environment node
import sharp from 'sharp';
import { Box3, Vector3, type AnimationClip, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeModel } from './normalize';
import { readGlb, statueGlb } from './testing/fixtures';

/** The same loader the app uses, as an independent check of the conventions. Texture-less models only. */
function loadWithThree(bytes: Uint8Array): Promise<{ scene: Group; animations: AnimationClip[] }> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', (g) => res(g), rej));
}

async function boxOf(bytes: Uint8Array) {
  const { scene } = await loadWithThree(bytes);
  scene.updateMatrixWorld(true);
  return new Box3().setFromObject(scene, true);
}

const FIVE = ['idle', 'attack', 'hit', 'die', 'victory'] as const;
const RIG_NAMES: Record<string, string | null> = {
  'Armature|Idle': 'idle',
  'Armature|Attack': 'attack',
  'Armature|Hit': 'hit',
  'Armature|Die': 'die',
  'Armature|Victory': 'victory',
  Walking: null,
};

describe('normalizeModel', () => {
  test('a rigged king ends on the spec conventions, as three sees it', async () => {
    const input = await statueGlb({ skinned: true, size: [0.5, 3, 0.5], center: [4, 7, 1], clips: Object.keys(RIG_NAMES) });
    const { glb, report } = await normalizeModel(input, { piece: 'w-king', keep: FIVE, rename: RIG_NAMES });

    const box = await boxOf(glb);
    const center = box.getCenter(new Vector3());
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.0, 3);
    expect(Math.abs(center.x)).toBeLessThan(0.02);
    expect(Math.abs(center.z)).toBeLessThan(0.02);

    const { animations } = await loadWithThree(glb);
    expect(animations.map((a) => a.name).sort()).toEqual([...FIVE].sort());
    expect(report).toMatchObject({ piece: 'w-king', clips: [...FIVE], warnings: [] });
    expect(report.heightUnits).toBeCloseTo(1, 4);
    expect(report.bytes).toBe(glb.byteLength);
  });

  test('pruning keeps the skeleton the clips animate', async () => {
    const input = await statueGlb({ skinned: true, clips: ['idle'] });
    const { glb } = await normalizeModel(input, { piece: 'w-queen', keep: ['idle'] });
    const names = (await readGlb(glb)).getRoot().listNodes().map((n) => n.getName());
    expect(names).toEqual(expect.arrayContaining(['normalized', 'root', 'tip', 'body']));
  });

  test('a rigid pawn keeps no clips and gets the pawn height', async () => {
    const input = await statueGlb({ size: [0.5, 1, 0.5], center: [0, 0.5, 0], clips: ['idle'] });
    const { glb, report } = await normalizeModel(input, { piece: 'b-pawn', keep: [] });
    expect(report.clips).toEqual([]);
    expect((await loadWithThree(glb)).animations).toEqual([]);
    expect((await boxOf(glb)).max.y).toBeCloseTo(0.55, 3);
  });

  test('extra clip files are merged onto the rigged base', async () => {
    const input = await statueGlb({ skinned: true });
    const attack = await statueGlb({ skinned: true, clips: ['whatever'] });
    const { glb, report } = await normalizeModel(input, {
      piece: 'b-bishop',
      keep: ['attack'],
      extraClips: [{ name: 'attack', bytes: attack }],
    });
    expect(report.clips).toEqual(['attack']);
    expect((await loadWithThree(glb)).animations.map((a) => a.name)).toEqual(['attack']);
  });

  test('rotateYDeg turns the model', async () => {
    const input = await statueGlb({ size: [1, 2, 0.4], center: [0, 1, 0] });
    const { glb } = await normalizeModel(input, { piece: 'w-knight', keep: [], rotateYDeg: 90 });
    const size = (await boxOf(glb)).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(size.x);
  });

  test('textures are shrunk to 1024 by default and to 2048 on request', async () => {
    const input = await statueGlb({ texturePx: 2048 });
    const width = async (maxTexturePx?: number) => {
      const { glb } = await normalizeModel(input, { piece: 'w-rook', keep: [], maxTexturePx });
      const image = (await readGlb(glb)).getRoot().listTextures()[0]!.getImage()!;
      return (await sharp(image).metadata()).width;
    };
    expect(await width()).toBe(1024);
    expect(await width(2048)).toBe(2048);
  });

  test('a Z-up model is rejected with the piece key in the message', async () => {
    const input = await statueGlb({ size: [0.4, 0.4, 2], center: [0, 0, 1] });
    await expect(normalizeModel(input, { piece: 'w-pawn', keep: [] })).rejects.toThrow(/^w-pawn: does not look Y-up/);
  });

  test('geometry far from the origin is rejected', async () => {
    const input = await statueGlb({ center: [30, 1, 0] });
    await expect(normalizeModel(input, { piece: 'w-pawn', keep: [] })).rejects.toThrow(/^w-pawn: .*from the origin/);
  });

  test('an unknown piece key is rejected before anything is read', async () => {
    await expect(normalizeModel(new Uint8Array([1, 2, 3]), { piece: 'w-dragon', keep: [] })).rejects.toThrow(
      /^w-dragon: unknown piece key/,
    );
  });

  test('bytes that are not a glb are rejected', async () => {
    await expect(normalizeModel(new Uint8Array([1, 2, 3]), { piece: 'w-king', keep: [] })).rejects.toThrow(
      /^w-king: the model is not a readable glb/,
    );
  });
});
