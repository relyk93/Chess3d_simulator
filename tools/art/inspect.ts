import { getBounds } from '@gltf-transform/functions';
import type { Document, Scene } from '@gltf-transform/core';
import { NormalizeError } from './spec';

export type Vec3 = [number, number, number];

export interface Measure {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

const fmt = (n: number) => n.toFixed(2);

export function theScene(doc: Document, piece: string): Scene {
  const scenes = doc.getRoot().listScenes();
  if (scenes.length !== 1) throw new NormalizeError(piece, `expected exactly one scene, found ${scenes.length}`);
  return scenes[0]!;
}

export function measure(scene: Scene, piece: string): Measure {
  const { min, max } = getBounds(scene);
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!size.every((n) => Number.isFinite(n) && n > 0)) {
    throw new NormalizeError(piece, 'the model has an empty or flat bounding box; is there geometry in the scene?');
  }
  return {
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
    size,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/** A chess piece is taller than it is wide. Much wider than tall means Z-up or lying down. */
export function assertYUp(m: Measure, piece: string): void {
  const wide = Math.max(m.size[0], m.size[2]);
  if (m.size[1] < 0.5 * wide) {
    throw new NormalizeError(
      piece,
      `does not look Y-up: it is ${fmt(m.size[1])} tall (y) but ${fmt(wide)} wide (x or z). Chess pieces are taller than wide; re-export the model Y-up.`,
    );
  }
}

/** A small offset from the origin is fixed by the transform; a huge one means the export is wrong. */
export function assertNotFarOff(m: Measure, piece: string): void {
  const offset = Math.hypot(m.center[0], m.center[2]);
  if (offset > 3 * m.size[1]) {
    throw new NormalizeError(
      piece,
      `its geometry is ${fmt(offset)} units from the origin, over 3 times its own height. The export probably includes other objects. Small offsets are fixed automatically; this one is too large to trust.`,
    );
  }
}
