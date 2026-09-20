import { Chess, type Move } from 'chess.js';
import type { Color, GameOverReason, MoveRequest, MoveResult, Piece, PromotionPiece, Square } from './types';
import { fileOf, makeSquare, rankOf } from './squares';

export interface GameCore {
  fen(): string;
  turn(): Color;
  pieceAt(square: Square): Piece | null;
  legalMoves(from: Square): Square[];
  needsPromotion(from: Square, to: Square): boolean;
  move(req: MoveRequest): MoveResult;
  undo(): MoveResult | null;
  history(): readonly MoveResult[];
  inCheck(): boolean;
  gameOver(): GameOverReason | null;
  reset(): void;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function createGameCore(fen: string = START_FEN): GameCore {
  const chess = new Chess(fen);
  const results: MoveResult[] = [];

  function gameOver(): GameOverReason | null {
    if (chess.isCheckmate()) return 'checkmate';
    if (chess.isStalemate()) return 'stalemate';
    if (chess.isInsufficientMaterial()) return 'insufficient';
    if (chess.isThreefoldRepetition()) return 'threefold';
    if (chess.isDraw()) return 'fifty-move';
    return null;
  }

  function toResult(m: Move): MoveResult {
    const from = m.from as Square;
    const to = m.to as Square;
    const piece: Piece = { type: m.piece, color: m.color };
    const r: MoveResult = { from, to, piece, san: m.san, check: chess.isCheck() };

    if (m.captured) {
      const square: Square = m.flags.includes('e') ? makeSquare(fileOf(to), rankOf(from)) : to;
      r.captured = { piece: { type: m.captured, color: m.color === 'w' ? 'b' : 'w' }, square };
    }
    if (m.flags.includes('k')) {
      r.castle = { rookFrom: makeSquare('h', rankOf(from)), rookTo: makeSquare('f', rankOf(from)) };
    } else if (m.flags.includes('q')) {
      r.castle = { rookFrom: makeSquare('a', rankOf(from)), rookTo: makeSquare('d', rankOf(from)) };
    }
    if (m.promotion) r.promotion = m.promotion as PromotionPiece;

    const over = gameOver();
    if (over) r.gameOver = over;
    return r;
  }

  function legalMoves(from: Square): Square[] {
    // chess.js emits one verbose move per promotion piece, so dedupe destinations.
    return [...new Set(chess.moves({ square: from, verbose: true }).map((m) => m.to as Square))];
  }

  return {
    fen: () => chess.fen(),
    turn: () => chess.turn(),
    pieceAt(square) {
      const p = chess.get(square);
      return p ? { type: p.type, color: p.color } : null;
    },
    legalMoves,
    needsPromotion(from, to) {
      const p = chess.get(from);
      if (!p || p.type !== 'p') return false;
      const lastRank = p.color === 'w' ? '8' : '1';
      return rankOf(to) === lastRank && legalMoves(from).includes(to);
    },
    move(req) {
      let m: Move;
      try {
        m = chess.move({ from: req.from, to: req.to, promotion: req.promotion });
      } catch {
        throw new Error(`Illegal move ${req.from}-${req.to}${req.promotion ?? ''}`);
      }
      const r = toResult(m);
      results.push(r);
      return r;
    },
    undo() {
      const m = chess.undo();
      if (!m) return null;
      return results.pop() ?? null;
    },
    history: () => results,
    inCheck: () => chess.isCheck(),
    gameOver,
    reset() {
      chess.load(START_FEN);
      results.length = 0;
    },
  };
}
