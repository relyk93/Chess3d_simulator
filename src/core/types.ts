export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'w' | 'b';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface MoveRequest {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export type GameOverReason = 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty-move';

export interface MoveResult {
  from: Square;
  to: Square;
  piece: Piece;
  /** Present on any capture. `square` differs from `to` on en passant. */
  captured?: { piece: Piece; square: Square };
  castle?: { rookFrom: Square; rookTo: Square };
  promotion?: PromotionPiece;
  san: string;
  check: boolean;
  gameOver?: GameOverReason;
}

/** Stable identity for a piece across moves, assigned by the controller. */
export type PieceId = string;

export const PIECE_HEIGHT: Record<PieceType, number> = {
  k: 1.0,
  q: 0.9,
  b: 0.75,
  n: 0.75,
  r: 0.7,
  p: 0.55,
};
