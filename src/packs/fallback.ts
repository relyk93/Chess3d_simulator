import { ALL_PIECE_KEYS, type BoardPack, type SetPack } from './types';

/**
 * Built-in packs used when a manifest cannot be loaded. They reference no files: every piece renders as its
 * placeholder and the board uses the Plan 1 colors, so the game is always playable.
 */
export const FALLBACK_SET: SetPack = {
  baseUrl: '',
  manifest: {
    id: 'fallback',
    name: 'Fallback',
    version: 1,
    sides: {
      w: { name: 'White', color: '#f4e9c8', impactEffect: 'sparks' },
      b: { name: 'Black', color: '#5a0d0d', impactEffect: 'sparks' },
    },
    pieces: Object.fromEntries(ALL_PIECE_KEYS.map((k) => [k, { model: '', clips: [] }])),
    audio: {},
    sequenceOverride: null,
  },
};

export const FALLBACK_BOARD: BoardPack = {
  baseUrl: '',
  manifest: {
    id: 'fallback',
    name: 'Fallback',
    version: 1,
    model: '',
    environment: '',
    squares: { light: '#8c8378', dark: '#3b3733', highlight: '#ffd66b', capture: '#ff5a3c' },
    ambient: { type: 'none', intensity: 0 },
  },
};
