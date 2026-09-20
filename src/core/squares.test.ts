import { ALL_SQUARES, fileOf, isDarkSquare, makeSquare, rankOf, squareToWorld } from './squares';

test('ALL_SQUARES has 64 unique entries starting at a1 and ending at h8', () => {
  expect(ALL_SQUARES).toHaveLength(64);
  expect(new Set(ALL_SQUARES).size).toBe(64);
  expect(ALL_SQUARES[0]).toBe('a1');
  expect(ALL_SQUARES[63]).toBe('h8');
});

test('fileOf, rankOf, makeSquare round-trip', () => {
  expect(fileOf('e4')).toBe('e');
  expect(rankOf('e4')).toBe('4');
  expect(makeSquare('e', '4')).toBe('e4');
});

test('squareToWorld maps corners with white on +z', () => {
  expect(squareToWorld('a1')).toEqual({ x: -3.5, z: 3.5 });
  expect(squareToWorld('h8')).toEqual({ x: 3.5, z: -3.5 });
  expect(squareToWorld('e4')).toEqual({ x: 0.5, z: 0.5 });
});

test('isDarkSquare: a1 is dark, h1 is light', () => {
  expect(isDarkSquare('a1')).toBe(true);
  expect(isDarkSquare('h1')).toBe(false);
  expect(isDarkSquare('a8')).toBe(false);
});
