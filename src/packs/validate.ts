import { ALL_PIECE_KEYS, AMBIENT_TYPES, CLIP_NAMES, IMPACT_EFFECTS, SOUND_NAMES, type BoardManifest, type SetManifest } from './types';

export class ManifestError extends Error {
  constructor(where: string, problem: string) {
    super(`Invalid manifest at ${where}: ${problem}`);
    this.name = 'ManifestError';
  }
}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ManifestError(where, 'expected an object');
  return v as Obj;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v === '') throw new ManifestError(where, 'expected a non-empty string');
  return v;
}

function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ManifestError(where, 'expected a number');
  return v;
}

function hex(v: unknown, where: string): string {
  const s = str(v, where);
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new ManifestError(where, `expected a #rrggbb color, got "${s}"`);
  return s;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ManifestError(where, `expected one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

export function parseSetManifest(json: unknown): SetManifest {
  const m = obj(json, 'set manifest');
  const sides = obj(m.sides, 'sides');
  const side = (c: 'w' | 'b') => {
    const s = obj(sides[c], `sides.${c}`);
    return {
      name: str(s.name, `sides.${c}.name`),
      color: hex(s.color, `sides.${c}.color`),
      impactEffect: oneOf(s.impactEffect, IMPACT_EFFECTS, `sides.${c}.impactEffect`),
    };
  };
  const rawPieces = obj(m.pieces, 'pieces');
  const pieces: SetManifest['pieces'] = {};
  for (const key of ALL_PIECE_KEYS) {
    const p = obj(rawPieces[key], `pieces.${key}`);
    const clips = p.clips;
    if (!Array.isArray(clips)) throw new ManifestError(`pieces.${key}.clips`, 'expected an array');
    pieces[key] = {
      model: str(p.model, `pieces.${key}.model`),
      clips: clips.map((c, i) => oneOf(c, CLIP_NAMES, `pieces.${key}.clips[${i}]`)),
    };
  }
  const rawAudio = m.audio === undefined ? {} : obj(m.audio, 'audio');
  const audio: SetManifest['audio'] = {};
  for (const [k, v] of Object.entries(rawAudio)) audio[oneOf(k, SOUND_NAMES, `audio.${k}`)] = str(v, `audio.${k}`);
  if (m.sequenceOverride !== null && m.sequenceOverride !== undefined) {
    throw new ManifestError('sequenceOverride', 'not supported yet; must be null');
  }
  return {
    id: str(m.id, 'id'),
    name: str(m.name, 'name'),
    version: num(m.version, 'version'),
    sides: { w: side('w'), b: side('b') },
    pieces,
    audio,
    sequenceOverride: null,
  };
}

export function parseBoardManifest(json: unknown): BoardManifest {
  const m = obj(json, 'board manifest');
  const sq = obj(m.squares, 'squares');
  const amb = obj(m.ambient, 'ambient');
  return {
    id: str(m.id, 'id'),
    name: str(m.name, 'name'),
    version: num(m.version, 'version'),
    model: str(m.model, 'model'),
    environment: str(m.environment, 'environment'),
    squares: {
      light: hex(sq.light, 'squares.light'),
      dark: hex(sq.dark, 'squares.dark'),
      highlight: hex(sq.highlight, 'squares.highlight'),
      capture: hex(sq.capture, 'squares.capture'),
    },
    ambient: { type: oneOf(amb.type, AMBIENT_TYPES, 'ambient.type'), intensity: num(amb.intensity, 'ambient.intensity') },
  };
}
