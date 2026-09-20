// @vitest-environment node
import type { Document } from '@gltf-transform/core';
import { measure, theScene } from './inspect';
import { statueDoc } from './testing/fixtures';
import { normalizeTransform } from './transform';

const sceneOf = (doc: Document) => theScene(doc, 'w-king');
const after = (doc: Document) => measure(sceneOf(doc), 'w-king');

describe('normalizeTransform', () => {
  test('scales to the target height, puts the base on y = 0 and centers x and z', async () => {
    const doc = await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] });
    const result = normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    const m = after(doc);
    expect(result.scale).toBeCloseTo(0.25, 6);
    expect(m.min[1]).toBeCloseTo(0, 5);
    expect(m.max[1]).toBeCloseTo(1, 5);
    expect(m.center[0]).toBeCloseTo(0, 5);
    expect(m.center[2]).toBeCloseTo(0, 5);
    expect(m.size[0]).toBeCloseTo(0.25, 5);
  });

  test('rotateYDeg turns the model before it is centered', async () => {
    const doc = await statueDoc({ size: [1, 2, 0.4], center: [0, 1, 0] });
    normalizeTransform(doc, sceneOf(doc), 'w-knight', { targetHeight: 0.75, rotateYDeg: 90 });
    const m = after(doc);
    expect(m.size[0]).toBeCloseTo(0.4 * 0.375, 4);
    expect(m.size[2]).toBeCloseTo(1 * 0.375, 4);
    expect(m.center[0]).toBeCloseTo(0, 4);
    expect(m.center[2]).toBeCloseTo(0, 4);
  });

  test('leaves one wrapper node under the scene', async () => {
    const doc = await statueDoc({ skinned: true });
    normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    expect(sceneOf(doc).listChildren().map((n) => n.getName())).toEqual(['normalized']);
  });

  test('works on a skinned model', async () => {
    const doc = await statueDoc({ skinned: true, size: [0.5, 3, 0.5], center: [1, 6, 0] });
    normalizeTransform(doc, sceneOf(doc), 'w-bishop', { targetHeight: 0.75 });
    const m = after(doc);
    expect(m.min[1]).toBeCloseTo(0, 5);
    expect(m.max[1]).toBeCloseTo(0.75, 5);
  });

  test('is idempotent: normalizing a normalized model changes nothing', async () => {
    const doc = await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] });
    normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    const once = after(doc);
    const again = normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    const twice = after(doc);
    expect(again.scale).toBeCloseTo(1, 5);
    expect(twice.size[1]).toBeCloseTo(once.size[1], 5);
    expect(twice.min[1]).toBeCloseTo(0, 5);
  });
});
