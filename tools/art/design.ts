import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPACT_EFFECTS, SOUND_NAMES, type SetManifest } from '../../src/packs/types';
import type { PoseMode } from './meshy/endpoints';
import { ALL_PIECE_KEYS, CLIP_NAMES, type ClipName } from './spec';

export interface PieceDesign {
  /** What the piece is, in a sentence, for the concept prompt. */
  subject: string;
  /** Rigged pieces get the five animation clips; rigid pieces use the engine's fallback motion. */
  rigged: boolean;
  /** Turn the model about Y (degrees) if Meshy did not make it face +Z. */
  rotateY?: number;
}

/** Everything about a set that the generation tools need, in one editable `design.json`. */
export interface Design {
  id: string;
  name: string;
  version: number;
  sides: SetManifest['sides'];
  style: string;
  sideLook: Record<'w' | 'b', string>;
  textToImageModel: string;
  imageTo3dModel: string;
  targetPolycount: number;
  /** Meshy does not document what image-to-3D costs. `null` until the first task reports it. */
  credits: { imageTo3d: number | null };
  heightMeters: number;
  pieces: Record<string, PieceDesign>;
  /** Meshy animation-library action id for each clip, or `null` until looked up with `art actions`. */
  actions: Record<ClipName, number | null>;
  /** Sound name to file, relative to the set's source folder. */
  audio: Record<string, string>;
}

export class DesignError extends Error {
  constructor(where: string, problem: string) {
    super(where ? `design.json ${where}: ${problem}` : `design.json: ${problem}`);
    this.name = 'DesignError';
  }
}

/** Rigged figures are generated in an A-pose so Meshy's auto-rigger accepts them. */
export function poseModeFor(piece: PieceDesign): PoseMode | undefined {
  return piece.rigged ? 'a-pose' : undefined;
}

export function defaultDesign(): Design {
  const figure = (subject: string): PieceDesign => ({ subject, rigged: true });
  const object = (subject: string): PieceDesign => ({ subject, rigged: false });
  const pieceKinds: Record<string, PieceDesign> = {
    king: figure('a majestic king standing upright in ornate regal armor with a tall crown, both hands resting on a sword planted point-down in front of him'),
    queen: figure('an elegant queen standing upright in a flowing armored gown with a tall crown, holding a scepter'),
    bishop: figure('a robed bishop standing upright in a tall pointed mitre, holding a long staff'),
    knight: figure('an armored knight, a humanoid warrior standing upright on two legs holding a sword and shield, wearing a plumed helmet, not a horse'),
    rook: object('a fortress tower in the shape of a chess rook, a round castle turret with crenellations, carved as one solid statue'),
    pawn: object('a small humble foot soldier standing upright holding a short spear, the smallest and simplest piece, compact'),
  };
  const pieces: Record<string, PieceDesign> = {};
  for (const key of ALL_PIECE_KEYS) pieces[key] = { ...pieceKinds[key.split('-')[1]!]! };

  return {
    id: 'angels-vs-demons',
    name: 'Angels vs Demons',
    version: 2,
    sides: {
      w: { name: 'Angels', color: '#f4e9c8', impactEffect: 'light' },
      b: { name: 'Demons', color: '#5a0d0d', impactEffect: 'fire' },
    },
    style: 'Stylized fantasy chess piece, high quality game asset, painterly hand-crafted look, dramatic but readable silhouette',
    sideLook: {
      w: 'radiant angelic theme, white marble and polished gold armor, soft golden glow, feathered wings folded close to the body',
      b: 'infernal demonic theme, obsidian black and crimson armor, glowing ember cracks, curved horns, bat-like wings folded close to the body',
    },
    textToImageModel: 'nano-banana',
    imageTo3dModel: 'latest',
    targetPolycount: 15000,
    credits: { imageTo3d: null },
    heightMeters: 1.7,
    pieces,
    actions: { idle: null, attack: 4, hit: null, die: null, victory: null },
    audio: {},
  };
}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DesignError(where, 'expected an object');
  return v as Obj;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new DesignError(where, 'expected a non-empty string');
  return v;
}

function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DesignError(where, 'expected a number');
  return v;
}

function noUnknown(o: Obj, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) throw new DesignError(where, `unknown field "${key}" (expected ${allowed.join(', ')})`);
  }
}

const TOP = [
  'id', 'name', 'version', 'sides', 'style', 'sideLook', 'textToImageModel', 'imageTo3dModel',
  'targetPolycount', 'credits', 'heightMeters', 'pieces', 'actions', 'audio',
] as const;

export function parseDesign(json: unknown): Design {
  const d = obj(json, '');
  noUnknown(d, TOP, '');

  const rawSides = obj(d.sides, 'sides');
  const side = (c: 'w' | 'b') => {
    const s = obj(rawSides[c], `sides.${c}`);
    const color = str(s.color, `sides.${c}.color`);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new DesignError(`sides.${c}.color`, `expected a #rrggbb color, got "${color}"`);
    const effect = s.impactEffect;
    if (typeof effect !== 'string' || !(IMPACT_EFFECTS as readonly string[]).includes(effect)) {
      throw new DesignError(`sides.${c}.impactEffect`, `expected one of ${IMPACT_EFFECTS.join(', ')}, got ${JSON.stringify(effect)}`);
    }
    return { name: str(s.name, `sides.${c}.name`), color, impactEffect: effect as SetManifest['sides']['w']['impactEffect'] };
  };

  const look = obj(d.sideLook, 'sideLook');

  const polycount = d.targetPolycount;
  if (typeof polycount !== 'number' || !Number.isInteger(polycount) || polycount < 100 || polycount > 300000) {
    throw new DesignError('targetPolycount', `expected a whole number from 100 to 300000, got ${JSON.stringify(polycount)}`);
  }

  const credits = obj(d.credits, 'credits');
  const cost = credits.imageTo3d;
  if (cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) {
    throw new DesignError('credits.imageTo3d', 'expected a number of credits (0 or more) or null');
  }

  const rawPieces = obj(d.pieces, 'pieces');
  for (const key of Object.keys(rawPieces)) {
    if (!ALL_PIECE_KEYS.includes(key)) throw new DesignError('pieces', `unknown piece "${key}"`);
  }
  const missing = ALL_PIECE_KEYS.filter((k) => !Object.hasOwn(rawPieces, k));
  if (missing.length > 0) throw new DesignError('pieces', `missing ${missing.join(', ')}`);
  const pieces: Record<string, PieceDesign> = {};
  for (const key of ALL_PIECE_KEYS) {
    const p = obj(rawPieces[key], `pieces.${key}`);
    noUnknown(p, ['subject', 'rigged', 'rotateY'], `pieces.${key}`);
    if (typeof p.rigged !== 'boolean') throw new DesignError(`pieces.${key}.rigged`, 'expected true or false');
    pieces[key] = {
      subject: str(p.subject, `pieces.${key}.subject`),
      rigged: p.rigged,
      ...(p.rotateY === undefined ? {} : { rotateY: num(p.rotateY, `pieces.${key}.rotateY`) }),
    };
  }

  const rawActions = obj(d.actions, 'actions');
  for (const key of Object.keys(rawActions)) {
    if (!(CLIP_NAMES as readonly string[]).includes(key)) throw new DesignError('actions', `unknown clip "${key}"`);
  }
  const actions = {} as Record<ClipName, number | null>;
  for (const clip of CLIP_NAMES) {
    const id = rawActions[clip];
    if (id !== null && !(typeof id === 'number' && Number.isInteger(id))) {
      throw new DesignError(`actions.${clip}`, `expected a whole number or null, got ${JSON.stringify(id)}`);
    }
    actions[clip] = id;
  }

  const rawAudio = obj(d.audio, 'audio');
  const audio: Record<string, string> = {};
  for (const [sound, file] of Object.entries(rawAudio)) {
    if (!(SOUND_NAMES as readonly string[]).includes(sound)) throw new DesignError('audio', `unknown sound "${sound}"`);
    audio[sound] = str(file, `audio.${sound}`);
  }

  const heightMeters = num(d.heightMeters, 'heightMeters');
  if (heightMeters <= 0) throw new DesignError('heightMeters', 'expected a positive number');

  return {
    id: str(d.id, 'id'),
    name: str(d.name, 'name'),
    version: num(d.version, 'version'),
    sides: { w: side('w'), b: side('b') },
    style: str(d.style, 'style'),
    sideLook: { w: str(look.w, 'sideLook.w'), b: str(look.b, 'sideLook.b') },
    textToImageModel: str(d.textToImageModel, 'textToImageModel'),
    imageTo3dModel: str(d.imageTo3dModel, 'imageTo3dModel'),
    targetPolycount: polycount,
    credits: { imageTo3d: cost },
    heightMeters,
    pieces,
    actions,
    audio,
  };
}

/** Reads and validates `design.json` from a set's source folder. */
export function loadDesign(dir: string): Design {
  const path = join(dir, 'design.json');
  if (!existsSync(path)) throw new DesignError('', `not found in ${dir}; create it with: pnpm art init-set ${dir}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new DesignError('', `is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  return parseDesign(json);
}
