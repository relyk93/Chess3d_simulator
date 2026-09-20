import { Material, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Clones a loaded glTF scene for one piece instance. Materials are cloned too, because fading or flashing one
 * piece must not touch the other pieces that share the same glb.
 */
export function prepareModel(source: Object3D): Object3D {
  const root = cloneSkinned(source);
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  return root;
}

export function disposeModelMaterials(root: Object3D): void {
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
  });
}

export interface Look {
  opacity: number;
  /** 0..1 red flash (rigid `hit`). */
  flash: number;
  /** 0..1 warm pulse (check). */
  pulse: number;
}

/** Writes opacity and emissive tint onto every standard material under `root`. Cheap to call every frame: it only writes changes. */
export function applyLook(root: Object3D, look: Look): void {
  const translucent = look.opacity < 0.999;
  const r = Math.min(1, look.flash + look.pulse);
  const g = Math.min(1, look.flash * 0.1 + look.pulse * 0.7);
  const b = Math.min(1, look.pulse * 0.15);
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const m = (o as Mesh).material;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (!(mat instanceof MeshStandardMaterial)) continue;
      if (mat.transparent !== translucent) {
        mat.transparent = translucent;
        mat.needsUpdate = true;
      }
      if (mat.opacity !== look.opacity) mat.opacity = look.opacity;
      if (mat.emissive.r !== r || mat.emissive.g !== g || mat.emissive.b !== b) mat.emissive.setRGB(r, g, b);
    }
  });
}
