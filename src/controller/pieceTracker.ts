import type { GameCore } from '../core/gameCore';
import { ALL_SQUARES } from '../core/squares';
import type { MoveResult, Piece, PieceId, Square } from '../core/types';

export interface PlacedPiece {
  square: Square;
  piece: Piece;
  captured: boolean;
  capturedAtPly?: number;
}

export type PieceMap = Record<PieceId, PlacedPiece>;

export function initialPieces(core: GameCore): PieceMap {
  const counts: Record<string, number> = {};
  const pieces: PieceMap = {};
  for (const square of ALL_SQUARES) {
    const piece = core.pieceAt(square);
    if (!piece) continue;
    const key = `${piece.color}-${piece.type}`;
    const n = counts[key] ?? 0;
    counts[key] = n + 1;
    pieces[`${key}-${n}`] = { square, piece, captured: false };
  }
  return pieces;
}

export function pieceIdAt(pieces: PieceMap, square: Square): PieceId | null {
  for (const [id, p] of Object.entries(pieces)) {
    if (!p.captured && p.square === square) return id;
  }
  return null;
}

function mustFind(pieces: PieceMap, square: Square): PieceId {
  const id = pieceIdAt(pieces, square);
  if (!id) throw new Error(`No live piece on ${square}`);
  return id;
}

export function applyMove(pieces: PieceMap, r: MoveResult, ply: number): PieceMap {
  const next: PieceMap = { ...pieces };
  if (r.captured) {
    const victim = mustFind(next, r.captured.square);
    next[victim] = { ...next[victim]!, captured: true, capturedAtPly: ply };
  }
  const mover = mustFind(next, r.from);
  next[mover] = {
    ...next[mover]!,
    square: r.to,
    piece: r.promotion ? { ...next[mover]!.piece, type: r.promotion } : next[mover]!.piece,
  };
  if (r.castle) {
    const rook = mustFind(next, r.castle.rookFrom);
    next[rook] = { ...next[rook]!, square: r.castle.rookTo };
  }
  return next;
}

export function revertMove(pieces: PieceMap, r: MoveResult, ply: number): PieceMap {
  const next: PieceMap = { ...pieces };
  const mover = mustFind(next, r.to);
  next[mover] = {
    ...next[mover]!,
    square: r.from,
    piece: r.promotion ? { ...next[mover]!.piece, type: 'p' } : next[mover]!.piece,
  };
  if (r.castle) {
    const rook = mustFind(next, r.castle.rookTo);
    next[rook] = { ...next[rook]!, square: r.castle.rookFrom };
  }
  if (r.captured) {
    const entry = Object.entries(next).find(([, p]) => p.captured && p.capturedAtPly === ply);
    if (!entry) throw new Error(`No piece captured at ply ${ply} to restore`);
    const [victim, p] = entry;
    next[victim] = { square: r.captured.square, piece: p.piece, captured: false };
  }
  return next;
}
