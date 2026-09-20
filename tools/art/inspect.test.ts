// @vitest-environment node
import { Document } from '@gltf-transform/core';
import { assertNotFarOff, assertYUp, measure, theScene } from './inspect';
import { statueDoc } from './testing/fixtures';

const sceneOf = (doc: Document) => theScene(doc, 'w-king');

describe('measure', () => {
  test('reports min, max, size and center in world space', async () => {
    const m = measure(sceneOf(await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] })), 'w-king');
    expect(m.size).toEqual([1, 4, 2]);
    expect(m.center).toEqual([3, 10, -2]);
    expect(m.min[1]).toBe(8);
  });

  test('rejects a scene with no geometry', () => {
    const doc = new Document();
    doc.createScene('empty');
    expect(() => measure(sceneOf(doc), 'w-king')).toThrow(/w-king: .*empty or flat/);
  });

  test('theScene rejects a file with two scenes', () => {
    const doc = new Document();
    doc.createScene('a');
    doc.createScene('b');
    expect(() => theScene(doc, 'w-king')).toThrow(/w-king: expected exactly one scene, found 2/);
  });
});

describe('assertYUp', () => {
  test('accepts a piece that is taller than wide', async () => {
    const m = measure(sceneOf(await statueDoc()), 'w-king');
    expect(() => assertYUp(m, 'w-king')).not.toThrow();
  });

  test('accepts a squat pawn-shaped model', async () => {
    const m = measure(sceneOf(await statueDoc({ size: [1, 1.1, 1], center: [0, 0.55, 0] })), 'b-pawn');
    expect(() => assertYUp(m, 'b-pawn')).not.toThrow();
  });

  test('rejects a Z-up model with a message that says what to do', async () => {
    const m = measure(sceneOf(await statueDoc({ size: [0.4, 0.4, 2], center: [0, 0, 1] })), 'w-king');
    expect(() => assertYUp(m, 'w-king')).toThrow(/w-king: does not look Y-up.*re-export the model Y-up/);
  });
});

describe('assertNotFarOff', () => {
  test('accepts a modest offset, which the transform will fix', async () => {
    const m = measure(sceneOf(await statueDoc({ center: [1, 1, 0] })), 'w-king');
    expect(() => assertNotFarOff(m, 'w-king')).not.toThrow();
  });

  test('rejects geometry far from its origin', async () => {
    const m = measure(sceneOf(await statueDoc({ center: [10, 1, 0] })), 'w-king');
    expect(() => assertNotFarOff(m, 'w-king')).toThrow(/w-king: .*from the origin/);
  });
});
