import type { File, Rank, Square } from './types';

export const FILES: readonly File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS: readonly Rank[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const ALL_SQUARES: readonly Square[] = RANKS.flatMap((r) => FILES.map((f) => `${f}${r}` as Square));

export function fileOf(sq: Square): File {
  return sq[0] as File;
}

export function rankOf(sq: Square): Rank {
  return sq[1] as Rank;
}

export function makeSquare(file: File, rank: Rank): Square {
  return `${file}${rank}`;
}

export function fileIndex(sq: Square): number {
  return FILES.indexOf(fileOf(sq));
}

export function rankIndex(sq: Square): number {
  return RANKS.indexOf(rankOf(sq));
}

/** Board centered at origin, one unit per square, white's side toward +z. */
export function squareToWorld(sq: Square): { x: number; z: number } {
  return { x: fileIndex(sq) - 3.5, z: 3.5 - rankIndex(sq) };
}

export function isDarkSquare(sq: Square): boolean {
  return (fileIndex(sq) + rankIndex(sq)) % 2 === 0;
}
