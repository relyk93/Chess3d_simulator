import type { Color, PieceType } from '../core/types';
import type { ClipName, ImpactEffect, SoundName } from '../sequencer/types';

export const IMPACT_EFFECTS: readonly ImpactEffect[] = ['light', 'fire', 'ice', 'shadow', 'sparks'];
export const CLIP_NAMES: readonly ClipName[] = ['idle', 'attack', 'hit', 'die', 'victory'];
export const SOUND_NAMES: readonly SoundName[] = ['attack', 'hit', 'die'];
export const AMBIENT_TYPES = ['none', 'lava-cracks'] as const;
export type AmbientType = (typeof AMBIENT_TYPES)[number];

const NAMES: Record<PieceType, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** Manifest key for a piece, e.g. `w-king`. */
export function pieceKey(color: Color, type: PieceType): string {
  return `${color}-${NAMES[type]}`;
}

export const ALL_PIECE_KEYS: readonly string[] = (['w', 'b'] as const).flatMap((c) =>
  (['k', 'q', 'r', 'b', 'n', 'p'] as const).map((t) => pieceKey(c, t)),
);

export interface SideManifest {
  name: string;
  color: string;
  impactEffect: ImpactEffect;
}

export interface PieceManifest {
  model: string;
  clips: ClipName[];
}

export interface SetManifest {
  id: string;
  name: string;
  version: number;
  sides: Record<Color, SideManifest>;
  pieces: Record<string, PieceManifest>;
  audio: Partial<Record<SoundName, string>>;
  sequenceOverride: null;
}

export interface BoardManifest {
  id: string;
  name: string;
  version: number;
  model: string;
  environment: string;
  squares: { light: string; dark: string; highlight: string; capture: string };
  ambient: { type: AmbientType; intensity: number };
}

/** A manifest plus the base URL its relative paths resolve against. */
export interface SetPack {
  manifest: SetManifest;
  baseUrl: string;
}

export interface BoardPack {
  manifest: BoardManifest;
  baseUrl: string;
}
