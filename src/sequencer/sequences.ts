import { squareToWorld } from '../core/squares';
import type { MoveResult, PieceId, Square } from '../core/types';
import type { CameraPose, ImpactEffect, Point2, Sequence, Step } from './types';

export const SLIDE_MS = 350;
export const CHECK_PULSE_MS = 1000;
export const CHECKMATE_ORBIT_MS = 6000;
/** Height at which impact bursts and the camera aim, roughly the middle of a piece. */
const MID_HEIGHT = 0.45;

export interface MoveSequenceContext {
  move: MoveResult;
  attackerId: PieceId;
  /** The captured piece, when the move captures. */
  defenderId?: PieceId;
  /** The rook, when the move castles. */
  rookId?: PieceId;
  /** The king that is now in check, when the move gives check. */
  checkedKingId?: PieceId;
  /** Impact style of the attacker's side. */
  impactEffect: ImpactEffect;
}

function unit(dx: number, dz: number): Point2 {
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** Low three-quarter view framing both squares, on the side the default camera looks from. */
export function captureCameraPose(from: Square, victimSquare: Square): CameraPose {
  const a = squareToWorld(from);
  const b = squareToWorld(victimSquare);
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const dir = unit(b.x - a.x, b.z - a.z);
  let perp = { x: -dir.z, z: dir.x };
  if (perp.z < 0 || (perp.z === 0 && perp.x < 0)) perp = { x: -perp.x, z: -perp.z };
  const back = 1.2;
  const side = 2.6 + dist * 0.35;
  return {
    position: { x: mid.x + perp.x * side - dir.x * back, y: 1.4, z: mid.z + perp.z * side - dir.z * back },
    target: { x: mid.x, y: MID_HEIGHT, z: mid.z },
  };
}

function checkPulse(ctx: MoveSequenceContext, at: number): Step[] {
  return ctx.checkedKingId && ctx.move.check
    ? [{ at, duration: CHECK_PULSE_MS, kind: 'piece.pulse', id: ctx.checkedKingId }]
    : [];
}

/** Plain move: a 350 ms slide. Castling slides the rook with the king. A capture with cinematics off just fades the victim. */
export function buildSlideSequence(ctx: MoveSequenceContext): Sequence {
  const { move } = ctx;
  const steps: Step[] = [{ at: 0, duration: SLIDE_MS, kind: 'piece.moveTo', id: ctx.attackerId, to: move.to }];
  if (move.castle && ctx.rookId) {
    steps.push({ at: 0, duration: SLIDE_MS, kind: 'piece.moveTo', id: ctx.rookId, to: move.castle.rookTo });
  }
  if (move.captured && ctx.defenderId) {
    steps.push({ at: 150, duration: 0, kind: 'audio.play', sound: 'hit' });
    steps.push({ at: 150, duration: 200, kind: 'piece.fadeOut', id: ctx.defenderId });
  }
  steps.push(...checkPulse(ctx, 0));
  return { steps };
}

/** The default capture cinematic, spec section 6. Total 3900 ms. */
export function buildCaptureSequence(ctx: MoveSequenceContext): Sequence {
  const { move } = ctx;
  if (!move.captured || !ctx.defenderId) throw new Error('buildCaptureSequence needs a capturing move and a defender id');
  const from = squareToWorld(move.from);
  const victim = squareToWorld(move.captured.square);
  const dir = unit(victim.x - from.x, victim.z - from.z);
  const approach: Point2 = { x: victim.x - dir.x * 0.5, z: victim.z - dir.z * 0.5 };
  const impact = { x: victim.x, y: MID_HEIGHT, z: victim.z };
  const atk = ctx.attackerId;
  const def = ctx.defenderId;
  return {
    steps: [
      { at: 0, duration: 900, kind: 'camera.flyTo', pose: captureCameraPose(move.from, move.captured.square) },
      { at: 700, duration: 600, kind: 'piece.play', id: atk, clip: 'attack' },
      { at: 700, duration: 600, kind: 'piece.moveTo', id: atk, to: approach },
      { at: 700, duration: 0, kind: 'audio.play', sound: 'attack' },
      { at: 1200, duration: 300, kind: 'piece.play', id: def, clip: 'hit' },
      { at: 1200, duration: 0, kind: 'effects.burst', position: impact, effect: ctx.impactEffect },
      { at: 1200, duration: 250, kind: 'camera.shake', intensity: 0.06 },
      { at: 1200, duration: 0, kind: 'audio.play', sound: 'hit' },
      { at: 1500, duration: 700, kind: 'piece.play', id: def, clip: 'die' },
      { at: 1500, duration: 700, kind: 'piece.fadeOut', id: def },
      { at: 1500, duration: 0, kind: 'audio.play', sound: 'die' },
      { at: 2300, duration: 600, kind: 'piece.play', id: atk, clip: 'victory' },
      { at: 2900, duration: 400, kind: 'piece.moveTo', id: atk, to: move.to },
      { at: 3000, duration: 900, kind: 'camera.restore' },
      ...checkPulse(ctx, 2900),
    ],
  };
}

export function buildMoveSequence(ctx: MoveSequenceContext, cinematic: boolean): Sequence {
  return cinematic && ctx.move.captured ? buildCaptureSequence(ctx) : buildSlideSequence(ctx);
}

/** Checkmate without a capture: a slow orbit while the losing king dies. */
export function buildCheckmateSequence(loserKingId: PieceId): Sequence {
  return {
    steps: [
      { at: 0, duration: CHECKMATE_ORBIT_MS, kind: 'camera.orbit', turns: 1 },
      { at: 300, duration: 700, kind: 'piece.play', id: loserKingId, clip: 'die' },
      { at: 300, duration: 0, kind: 'audio.play', sound: 'die' },
      { at: 1000, duration: 500, kind: 'piece.fadeOut', id: loserKingId },
    ],
  };
}
