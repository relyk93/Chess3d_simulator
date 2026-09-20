// @vitest-environment node
import { ALL_PIECE_KEYS, NormalizeError, pieceHeight } from './spec';

describe('art spec constants', () => {
  test('heights match spec 5.2', () => {
    expect(pieceHeight('w-king')).toBe(1.0);
    expect(pieceHeight('b-queen')).toBe(0.9);
    expect(pieceHeight('w-bishop')).toBe(0.75);
    expect(pieceHeight('b-knight')).toBe(0.75);
    expect(pieceHeight('w-rook')).toBe(0.7);
    expect(pieceHeight('b-pawn')).toBe(0.55);
  });

  test('every one of the 12 piece keys has a height', () => {
    expect(ALL_PIECE_KEYS).toHaveLength(12);
    for (const key of ALL_PIECE_KEYS) expect(pieceHeight(key)).toBeGreaterThan(0);
  });

  test('an unknown key is a NormalizeError that lists the valid keys', () => {
    expect(() => pieceHeight('w-dragon')).toThrow(NormalizeError);
    expect(() => pieceHeight('w-dragon')).toThrow(/w-dragon: unknown piece key.*w-king/);
  });
});
