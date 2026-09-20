import { ALL_PIECE_KEYS, CLIP_NAMES } from '../../src/packs/types';
import type { ClipName } from '../../src/sequencer/types';

export { ALL_PIECE_KEYS, CLIP_NAMES };
export type { ClipName };

/** Spec 5.2 height table, in world units. One square is 1.0 wide. */
export const HEIGHT_BY_NAME = { king: 1.0, queen: 0.9, bishop: 0.75, knight: 0.75, rook: 0.7, pawn: 0.55 } as const;
export type PieceName = keyof typeof HEIGHT_BY_NAME;

/** Spec section 9: the pieces Version A rigs. The rest ship with no clips. */
export const RIGGED_NAMES: readonly PieceName[] = ['king', 'queen', 'bishop', 'knight'];

export const MAX_MODEL_BYTES = 2 * 1024 * 1024;
export const MAX_TEXTURE_PX = 2048;
export const DEFAULT_TEXTURE_PX = 1024;

export class NormalizeError extends Error {
  constructor(piece: string, problem: string) {
    super(`${piece}: ${problem}`);
    this.name = 'NormalizeError';
  }
}

export function pieceHeight(piece: string): number {
  const name = piece.split('-')[1];
  if (name === undefined || !ALL_PIECE_KEYS.includes(piece)) {
    throw new NormalizeError(piece, `unknown piece key; expected one of ${ALL_PIECE_KEYS.join(', ')}`);
  }
  return HEIGHT_BY_NAME[name as PieceName];
}
