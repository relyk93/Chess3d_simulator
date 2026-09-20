import type { PieceMap } from '../controller/pieceTracker';
import { pieceIdAt } from '../controller/pieceTracker';
import type { ControllerState } from '../controller/store';
import type { Color, PieceId } from '../core/types';
import type { ImpactEffect } from './types';
import type { MoveSequenceContext } from './sequences';

export function capturedIdAtPly(pieces: PieceMap, ply: number): PieceId | undefined {
  return Object.entries(pieces).find(([, p]) => p.captured && p.capturedAtPly === ply)?.[0];
}

export function kingIdOf(pieces: PieceMap, color: Color): PieceId | undefined {
  return Object.entries(pieces).find(([, p]) => !p.captured && p.piece.type === 'k' && p.piece.color === color)?.[0];
}

/**
 * Reads the state the controller has just advanced to and works out which pieces the last move involved.
 * Returns null if the state is inconsistent (no last move, or no piece where the mover should now be).
 */
export function moveContextFromState(
  s: Pick<ControllerState, 'lastMove' | 'history' | 'pieces' | 'turn'>,
  impactEffect: (side: Color) => ImpactEffect,
): MoveSequenceContext | null {
  const move = s.lastMove;
  if (!move) return null;
  const attackerId = pieceIdAt(s.pieces, move.to);
  if (!attackerId) return null;
  return {
    move,
    attackerId,
    defenderId: move.captured ? capturedIdAtPly(s.pieces, s.history.length - 1) : undefined,
    rookId: move.castle ? (pieceIdAt(s.pieces, move.castle.rookTo) ?? undefined) : undefined,
    // After the move it is the opponent's turn, so the king in check is the side to move's king.
    checkedKingId: move.check ? kingIdOf(s.pieces, s.turn) : undefined,
    impactEffect: impactEffect(move.piece.color),
  };
}
