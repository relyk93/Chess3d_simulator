import type { Document, Scene } from '@gltf-transform/core';
import { measure } from './inspect';

export interface TransformOptions {
  /** World height the model must end up with, in units. */
  targetHeight: number;
  /** Turn the model about Y before measuring, for exports that face -Z, +X or -X. */
  rotateYDeg?: number;
}

export interface TransformResult {
  scale: number;
  translation: [number, number, number];
}

/**
 * Wraps the scene's contents in one node named `normalized` and gives it the rotation, scale and
 * translation that put the model's base on y = 0, centered on x and z, at the target height.
 * One wrapper is safe for skinned and animated models, where editing every node is not.
 */
export function normalizeTransform(doc: Document, scene: Scene, piece: string, opts: TransformOptions): TransformResult {
  const wrapper = doc.createNode('normalized');
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);

  const half = ((opts.rotateYDeg ?? 0) * Math.PI) / 360;
  wrapper.setRotation([0, Math.sin(half), 0, Math.cos(half)]);

  const m = measure(scene, piece);
  const scale = opts.targetHeight / m.size[1];
  const translation: [number, number, number] = [-scale * m.center[0], -scale * m.min[1], -scale * m.center[2]];
  wrapper.setScale([scale, scale, scale]).setTranslation(translation);
  return { scale, translation };
}
