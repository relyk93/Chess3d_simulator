import { useMemo } from 'react';
import { ALL_SQUARES, isDarkSquare, squareToWorld } from '../core/squares';
import type { Square } from '../core/types';
import { useActions, useController } from '../controller/context';
import { SQUARE_COLORS } from './colors';

function squareColor(sq: Square, selected: Square | null, targets: Square[], occupied: Set<Square>): string {
  if (sq === selected) return SQUARE_COLORS.selected;
  if (targets.includes(sq)) return occupied.has(sq) ? SQUARE_COLORS.capture : SQUARE_COLORS.highlight;
  return isDarkSquare(sq) ? SQUARE_COLORS.dark : SQUARE_COLORS.light;
}

export function Board() {
  const { clickSquare } = useActions();
  const selected = useController((s) => s.selected);
  const targets = useController((s) => s.legalTargets);
  const pieces = useController((s) => s.pieces);
  const occupied = useMemo(
    () => new Set(Object.values(pieces).filter((p) => !p.captured).map((p) => p.square)),
    [pieces],
  );

  return (
    <group>
      {/* Slab under the squares */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[9, 0.3, 9]} />
        <meshStandardMaterial color="#1b1a1f" roughness={0.9} />
      </mesh>
      {ALL_SQUARES.map((sq) => {
        const { x, z } = squareToWorld(sq);
        return (
          <mesh
            key={sq}
            name={`square-${sq}`}
            position={[x, 0.005, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              clickSquare(sq);
            }}
          >
            <planeGeometry args={[1, 1]} />
            <meshStandardMaterial color={squareColor(sq, selected, targets, occupied)} roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}
