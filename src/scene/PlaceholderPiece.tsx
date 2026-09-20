import { squareToWorld } from '../core/squares';
import { PIECE_HEIGHT, type Piece, type Square } from '../core/types';
import { SIDE_COLORS } from './colors';

interface Props {
  piece: Piece;
  square: Square;
  onClick: () => void;
}

/** Primitive stand-ins until Plan 2 loads real models: capsule for pawns, box for rooks, cone otherwise. */
export function PlaceholderPiece({ piece, square, onClick }: Props) {
  const { x, z } = squareToWorld(square);
  const h = PIECE_HEIGHT[piece.type];
  const color = SIDE_COLORS[piece.color];
  const rotationY = piece.color === 'b' ? Math.PI : 0;
  return (
    <group position={[x, 0, z]} rotation={[0, rotationY, 0]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {piece.type === 'p' && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <capsuleGeometry args={[0.18, h - 0.36, 4, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {piece.type === 'r' && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[0.45, h, 0.45]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {piece.type !== 'p' && piece.type !== 'r' && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <coneGeometry args={[0.3, h, piece.type === 'k' ? 4 : piece.type === 'q' ? 8 : 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}
