import { buildGlb, type MeshData } from './glb';
import { box, merge, type Geometry } from './shapes';
import { srgbHexToLinear } from './pieces';

/** Thin strips along every grid line between squares. The engine renders the lava shader on the mesh named `cracks`. */
function crackGeometry(): Geometry {
  const parts: Geometry[] = [];
  for (let i = 0; i <= 8; i++) {
    const p = i - 4;
    parts.push(box(p, 0.001, 0, 0.08, 0.002, 8.08));
    parts.push(box(0, 0.001, p, 8.08, 0.002, 0.08));
  }
  const g = merge(parts);
  // UVs span the board so the shader's noise field is continuous across strips.
  g.uvs = [];
  for (let i = 0; i < g.positions.length; i += 3) g.uvs.push(g.positions[i]! / 9 + 0.5, g.positions[i + 2]! / 9 + 0.5);
  return g;
}

export function buildBoardGlb(): Uint8Array {
  const slab = box(0, -0.15, 0, 9, 0.3, 9);
  const frame = merge([
    box(0, 0.05, -4.25, 9, 0.1, 0.5),
    box(0, 0.05, 4.25, 9, 0.1, 0.5),
    box(-4.25, 0.05, 0, 0.5, 0.1, 8),
    box(4.25, 0.05, 0, 0.5, 0.1, 8),
  ]);
  const cracks = crackGeometry();
  const meshes: MeshData[] = [
    { name: 'slab', ...slab, material: { color: srgbHexToLinear('#1b1a1f'), metallic: 0, roughness: 0.9 } },
    { name: 'frame', ...frame, material: { color: srgbHexToLinear('#2a2830'), metallic: 0.1, roughness: 0.8 } },
    { name: 'cracks', ...cracks, material: { color: srgbHexToLinear('#ff5a1a'), metallic: 0, roughness: 1 } },
  ];
  return buildGlb(meshes);
}
