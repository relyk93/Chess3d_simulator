import { buildGlb, type ClipData, type MeshData } from './glb';
import { box, lathe, merge, type Geometry } from './shapes';

export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export type Color = 'w' | 'b';

export const PIECE_NAMES: Record<PieceType, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
export const PIECE_HEIGHT: Record<PieceType, number> = { k: 1.0, q: 0.9, b: 0.75, n: 0.75, r: 0.7, p: 0.55 };
/** Piece types that ship animation clips in the dev pack (spec section 9: the rigged four). */
export const RIGGED: readonly PieceType[] = ['k', 'q', 'b', 'n'];
export const SIDE_HEX: Record<Color, string> = { w: '#f4e9c8', b: '#5a0d0d' };

export function srgbHexToLinear(hex: string): [number, number, number, number] {
  const c = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [c(0), c(1), c(2), 1];
}

function geometryFor(type: PieceType): Geometry {
  switch (type) {
    case 'p':
      return lathe([[0, 0], [0.22, 0], [0.22, 0.05], [0.14, 0.12], [0.1, 0.3], [0.16, 0.34], [0.1, 0.38], [0.15, 0.43], [0.16, 0.48], [0.11, 0.53], [0.04, 0.55], [0, 0.55]]);
    case 'r':
      return lathe([[0, 0], [0.3, 0], [0.3, 0.08], [0.2, 0.16], [0.2, 0.5], [0.28, 0.56], [0.28, 0.7], [0, 0.7]]);
    case 'b':
      return lathe([[0, 0], [0.28, 0], [0.28, 0.07], [0.16, 0.16], [0.11, 0.4], [0.2, 0.48], [0.16, 0.6], [0.06, 0.72], [0, 0.75]]);
    case 'q':
      return lathe([[0, 0], [0.3, 0], [0.3, 0.08], [0.18, 0.18], [0.12, 0.5], [0.24, 0.62], [0.2, 0.72], [0.28, 0.82], [0.1, 0.86], [0, 0.9]]);
    case 'k':
      return merge([
        lathe([[0, 0], [0.32, 0], [0.32, 0.08], [0.2, 0.2], [0.13, 0.5], [0.26, 0.62], [0.2, 0.78], [0, 0.78]]),
        box(0, 0.9, 0, 0.09, 0.2, 0.09),
        box(0, 0.93, 0, 0.24, 0.08, 0.09),
      ]);
    case 'n':
      return merge([
        lathe([[0, 0], [0.28, 0], [0.28, 0.07], [0.18, 0.16], [0.18, 0.25], [0, 0.25]]),
        box(0, 0.5, 0, 0.22, 0.5, 0.3),
        box(0, 0.62, 0.14, 0.2, 0.2, 0.18),
      ]);
  }
}

const rotX = (a: number): number[] => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const rotY = (a: number): number[] => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const rotZ = (a: number): number[] => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

/** Node-transform clips named exactly as spec section 5.2 requires. `idle` starts and ends on the same pose so it loops. */
export function clipsFor(node: string): ClipData[] {
  return [
    { name: 'idle', node, times: [0, 0.75, 1.5, 2.25, 3], rotations: [...rotY(0), ...rotY(0.06), ...rotY(0), ...rotY(-0.06), ...rotY(0)] },
    { name: 'attack', node, times: [0, 0.15, 0.3, 0.6], rotations: [...rotX(0), ...rotX(0.45), ...rotX(-0.15), ...rotX(0)] },
    { name: 'hit', node, times: [0, 0.05, 0.1, 0.15, 0.2], rotations: [...rotZ(0), ...rotZ(0.18), ...rotZ(-0.18), ...rotZ(0.08), ...rotZ(0)] },
    { name: 'die', node, times: [0, 0.6], rotations: [...rotX(0), ...rotX(-1.4)] },
    { name: 'victory', node, times: [0, 0.25, 0.5], translations: [0, 0, 0, 0, 0.15, 0, 0, 0, 0] },
  ];
}

export function buildPieceGlb(color: Color, type: PieceType): Uint8Array {
  const name = `${color}-${PIECE_NAMES[type]}`;
  const g = geometryFor(type);
  const mesh: MeshData = {
    name,
    positions: g.positions,
    normals: g.normals,
    uvs: g.uvs,
    indices: g.indices,
    material: { color: srgbHexToLinear(SIDE_HEX[color]), metallic: 0.1, roughness: 0.55 },
  };
  return buildGlb([mesh], RIGGED.includes(type) ? clipsFor(name) : []);
}
