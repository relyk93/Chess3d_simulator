import { createGameCore } from '../core/gameCore';
import { applyMove, initialPieces, pieceIdAt, revertMove, type PieceMap } from './pieceTracker';

function live(pieces: PieceMap) {
  return Object.values(pieces).filter((p) => !p.captured).length;
}

test('initialPieces creates 32 pieces with deterministic ids', () => {
  const pieces = initialPieces(createGameCore());
  expect(Object.keys(pieces)).toHaveLength(32);
  expect(pieces['w-k-0']).toEqual({ square: 'e1', piece: { type: 'k', color: 'w' }, captured: false });
  expect(pieces['b-p-7']?.square).toBe('h7');
  expect(pieceIdAt(pieces, 'a1')).toBe('w-r-0');
  expect(pieceIdAt(pieces, 'e4')).toBeNull();
});

test('applyMove moves the piece and keeps its id', () => {
  const core = createGameCore();
  const p0 = initialPieces(core);
  const id = pieceIdAt(p0, 'e2')!;
  const r = core.move({ from: 'e2', to: 'e4' });
  const p1 = applyMove(p0, r, 0);
  expect(p1[id]?.square).toBe('e4');
  expect(pieceIdAt(p1, 'e2')).toBeNull();
  expect(p0[id]?.square).toBe('e2'); // pure
});

test('applyMove marks captured pieces and revertMove restores them', () => {
  const core = createGameCore();
  let pieces = initialPieces(core);
  const r1 = core.move({ from: 'e2', to: 'e4' }); pieces = applyMove(pieces, r1, 0);
  const r2 = core.move({ from: 'd7', to: 'd5' }); pieces = applyMove(pieces, r2, 1);
  const victim = pieceIdAt(pieces, 'd5')!;
  const r3 = core.move({ from: 'e4', to: 'd5' }); pieces = applyMove(pieces, r3, 2);
  expect(pieces[victim]).toMatchObject({ captured: true, capturedAtPly: 2 });
  expect(live(pieces)).toBe(31);
  expect(pieceIdAt(pieces, 'd5')).toBe('w-p-4');

  pieces = revertMove(pieces, r3, 2);
  expect(pieces[victim]).toEqual({ square: 'd5', piece: { type: 'p', color: 'b' }, captured: false });
  expect(pieceIdAt(pieces, 'e4')).toBe('w-p-4');
  expect(live(pieces)).toBe(32);
});

test('en passant removes the pawn on its own square', () => {
  const core = createGameCore('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  let pieces = initialPieces(core);
  const victim = pieceIdAt(pieces, 'd5')!;
  const r = core.move({ from: 'e5', to: 'd6' });
  pieces = applyMove(pieces, r, 0);
  expect(pieces[victim]?.captured).toBe(true);
  expect(pieceIdAt(pieces, 'd6')).not.toBeNull();
});

test('castling moves the rook too, and revert moves it back', () => {
  const core = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  let pieces = initialPieces(core);
  const rook = pieceIdAt(pieces, 'h1')!;
  const r = core.move({ from: 'e1', to: 'g1' });
  pieces = applyMove(pieces, r, 0);
  expect(pieces[rook]?.square).toBe('f1');
  pieces = revertMove(pieces, r, 0);
  expect(pieces[rook]?.square).toBe('h1');
});

test('promotion changes the piece type, revert restores the pawn', () => {
  const core = createGameCore('8/P7/8/8/8/8/8/k6K w - - 0 1');
  let pieces = initialPieces(core);
  const pawn = pieceIdAt(pieces, 'a7')!;
  const r = core.move({ from: 'a7', to: 'a8', promotion: 'q' });
  pieces = applyMove(pieces, r, 0);
  expect(pieces[pawn]?.piece).toEqual({ type: 'q', color: 'w' });
  pieces = revertMove(pieces, r, 0);
  expect(pieces[pawn]?.piece).toEqual({ type: 'p', color: 'w' });
  expect(pieces[pawn]?.square).toBe('a7');
});
