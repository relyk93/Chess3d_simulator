import { PIECE_HEIGHT, type PieceType } from '../core/types';

/**
 * Primitive stand-in used while a model loads, when a model fails to load, and when the set pack itself is
 * missing (spec section 4.4): a capsule for pawns, a box for rooks, a cone for everything else, in the side's color.
 */
export function PlaceholderBody({ type, color }: { type: PieceType; color: string }) {
  const h = PIECE_HEIGHT[type];
  return (
    <mesh position={[0, h / 2, 0]} castShadow>
      {type === 'p' && <capsuleGeometry args={[0.18, h - 0.36, 4, 12]} />}
      {type === 'r' && <boxGeometry args={[0.45, h, 0.45]} />}
      {type !== 'p' && type !== 'r' && <coneGeometry args={[0.3, h, type === 'k' ? 4 : type === 'q' ? 8 : 16]} />}
      <meshStandardMaterial color={color} />
    </mesh>
  );
}
