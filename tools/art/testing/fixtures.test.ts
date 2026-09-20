// @vitest-environment node
import sharp from 'sharp';
import { getBounds } from '@gltf-transform/functions';
import type { Document } from '@gltf-transform/core';
import { readGlb, statueDoc, statueGlb } from './fixtures';

const bounds = (doc: Document) => getBounds(doc.getRoot().listScenes()[0]!);

describe('statue fixture', () => {
  test('the default statue is a 0.4 x 2 x 0.4 box standing on y = 0', async () => {
    const b = bounds(await statueDoc());
    expect(b.min[1]).toBeCloseTo(0, 5);
    expect(b.max[1]).toBeCloseTo(2, 5);
    expect(b.max[0] - b.min[0]).toBeCloseTo(0.4, 5);
  });

  test('size and center are honoured', async () => {
    const b = bounds(await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] }));
    expect(b.min).toEqual([2.5, 8, -3]);
    expect(b.max).toEqual([3.5, 12, -1]);
  });

  test('a skinned statue has a two-joint skin and its clips animate the tip joint', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['attack'] });
    const skin = doc.getRoot().listSkins()[0]!;
    expect(skin.listJoints().map((j) => j.getName())).toEqual(['root', 'tip']);
    const channel = doc.getRoot().listAnimations()[0]!.listChannels()[0]!;
    expect(channel.getTargetNode()?.getName()).toBe('tip');
  });

  test('an idle clip loops unless openIdle is set', async () => {
    const values = async (openIdle: boolean) => {
      const doc = await statueDoc({ clips: ['idle'], openIdle });
      const out = doc.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput()!.getArray()!;
      return [Array.from(out.slice(0, 3)), Array.from(out.slice(-3))];
    };
    const [firstClosed, lastClosed] = await values(false);
    expect(lastClosed).toEqual(firstClosed);
    const [firstOpen, lastOpen] = await values(true);
    expect(lastOpen).not.toEqual(firstOpen);
  });

  test('a texture is attached at the requested size', async () => {
    const doc = await statueDoc({ texturePx: 256 });
    const meta = await sharp(doc.getRoot().listTextures()[0]!.getImage()!).metadata();
    expect(meta.width).toBe(256);
  });

  test('a statue survives a glb round trip with its clips', async () => {
    const back = await readGlb(await statueGlb({ skinned: true, clips: ['idle', 'attack'] }));
    expect(back.getRoot().listAnimations().map((a) => a.getName()).sort()).toEqual(['attack', 'idle']);
  });
});
