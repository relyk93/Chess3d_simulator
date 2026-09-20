import { createGameCore } from './gameCore';

describe('createGameCore', () => {
  test('start position: white to move, e2 pawn has two legal moves', () => {
    const g = createGameCore();
    expect(g.turn()).toBe('w');
    expect(g.pieceAt('e2')).toEqual({ type: 'p', color: 'w' });
    expect(g.pieceAt('e4')).toBeNull();
    expect(g.legalMoves('e2').sort()).toEqual(['e3', 'e4']);
    expect(g.legalMoves('e4')).toEqual([]);
    expect(g.gameOver()).toBeNull();
  });

  test('a plain move returns a MoveResult with san and no capture', () => {
    const g = createGameCore();
    const r = g.move({ from: 'e2', to: 'e4' });
    expect(r).toMatchObject({ from: 'e2', to: 'e4', piece: { type: 'p', color: 'w' }, san: 'e4', check: false });
    expect(r.captured).toBeUndefined();
    expect(r.castle).toBeUndefined();
    expect(g.turn()).toBe('b');
    expect(g.history()).toHaveLength(1);
  });

  test('illegal move throws and leaves state untouched', () => {
    const g = createGameCore();
    expect(() => g.move({ from: 'e2', to: 'e5' })).toThrow(/illegal/i);
    expect(g.turn()).toBe('w');
    expect(g.history()).toHaveLength(0);
  });

  test('capture reports the captured piece on the destination square', () => {
    const g = createGameCore();
    g.move({ from: 'e2', to: 'e4' });
    g.move({ from: 'd7', to: 'd5' });
    const r = g.move({ from: 'e4', to: 'd5' });
    expect(r.captured).toEqual({ piece: { type: 'p', color: 'b' }, square: 'd5' });
  });

  test('en passant reports the captured pawn on its own square', () => {
    const g = createGameCore('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    const r = g.move({ from: 'e5', to: 'd6' });
    expect(r.captured).toEqual({ piece: { type: 'p', color: 'b' }, square: 'd5' });
    expect(g.pieceAt('d5')).toBeNull();
  });

  test('castling reports rook movement for both sides', () => {
    const k = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(k.move({ from: 'e1', to: 'g1' }).castle).toEqual({ rookFrom: 'h1', rookTo: 'f1' });
    const q = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(q.move({ from: 'e1', to: 'c1' }).castle).toEqual({ rookFrom: 'a1', rookTo: 'd1' });
    const bq = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1');
    expect(bq.move({ from: 'e8', to: 'c8' }).castle).toEqual({ rookFrom: 'a8', rookTo: 'd8' });
  });

  test('promotion: needsPromotion is true only for a pawn reaching the last rank', () => {
    const g = createGameCore('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.needsPromotion('a7', 'a8')).toBe(true);
    expect(g.needsPromotion('h1', 'h2')).toBe(false);
    const r = g.move({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(r.promotion).toBe('q');
    expect(g.pieceAt('a8')).toEqual({ type: 'q', color: 'w' });
  });

  test('legalMoves lists each destination once even when promotion yields several moves', () => {
    const g = createGameCore('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.legalMoves('a7')).toEqual(['a8']);
  });

  test("scholar's mate reports check and checkmate", () => {
    const g = createGameCore();
    for (const [from, to] of [['e2','e4'],['e7','e5'],['f1','c4'],['b8','c6'],['d1','h5'],['g8','f6']] as const) {
      g.move({ from, to });
    }
    const r = g.move({ from: 'h5', to: 'f7' });
    expect(r.check).toBe(true);
    expect(r.gameOver).toBe('checkmate');
    expect(g.inCheck()).toBe(true);
    expect(g.gameOver()).toBe('checkmate');
  });

  test('stalemate is reported', () => {
    const g = createGameCore('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    const r = g.move({ from: 'g6', to: 'h6' });
    expect(r.gameOver).toBe('stalemate');
    expect(g.gameOver()).toBe('stalemate');
  });

  test('insufficient material is reported', () => {
    const g = createGameCore('k7/8/8/8/8/8/8/K6N w - - 0 1');
    expect(g.gameOver()).toBe('insufficient');
  });

  test('undo restores the board and returns the undone MoveResult', () => {
    const g = createGameCore();
    g.move({ from: 'e2', to: 'e4' });
    const undone = g.undo();
    expect(undone?.san).toBe('e4');
    expect(g.pieceAt('e2')).toEqual({ type: 'p', color: 'w' });
    expect(g.pieceAt('e4')).toBeNull();
    expect(g.turn()).toBe('w');
    expect(g.history()).toHaveLength(0);
    expect(g.undo()).toBeNull();
  });

  test('reset returns to the start position and clears history', () => {
    const g = createGameCore();
    g.move({ from: 'e2', to: 'e4' });
    g.reset();
    expect(g.fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(g.history()).toHaveLength(0);
  });
});
