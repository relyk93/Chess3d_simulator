import { squareToWorld } from '../core/squares';
import type { MoveResult } from '../core/types';
import { createSequencer, sequenceDuration } from './sequencer';
import {
  buildCaptureSequence,
  buildCheckmateSequence,
  buildMoveSequence,
  buildSlideSequence,
  captureCameraPose,
  type MoveSequenceContext,
} from './sequences';
import { createFakeClock, createRecordingHandles } from './testing';

const pawn = { type: 'p', color: 'w' } as const;
const blackPawn = { type: 'p', color: 'b' } as const;

const capture: MoveResult = { from: 'e4', to: 'd5', piece: pawn, captured: { piece: blackPawn, square: 'd5' }, san: 'exd5', check: false };
const quiet: MoveResult = { from: 'e2', to: 'e4', piece: pawn, san: 'e4', check: false };
const castle: MoveResult = { from: 'e1', to: 'g1', piece: { type: 'k', color: 'w' }, castle: { rookFrom: 'h1', rookTo: 'f1' }, san: 'O-O', check: false };

const ctx = (move: MoveResult, extra: Partial<MoveSequenceContext> = {}): MoveSequenceContext => ({
  move,
  attackerId: 'atk',
  impactEffect: 'light',
  ...extra,
});

describe('default capture sequence (spec section 6)', () => {
  const seq = buildCaptureSequence(ctx(capture, { defenderId: 'def' }));

  test('matches the spec table, step for step', () => {
    const rows = seq.steps.map((s) => {
      const target = 'id' in s ? (s.id === 'atk' ? 'attacker' : 'defender') : s.kind.split('.')[0];
      const action = s.kind.split('.')[1] + ('clip' in s ? `:${s.clip}` : '') + ('sound' in s ? `:${s.sound}` : '');
      return `${s.at} ${target} ${action} ${s.duration}`;
    });
    expect(rows).toEqual([
      '0 camera flyTo 900',
      '700 attacker play:attack 600',
      '700 attacker moveTo 600',
      '700 audio play:attack 0',
      '1200 defender play:hit 300',
      '1200 effects burst 0',
      '1200 camera shake 250',
      '1200 audio play:hit 0',
      '1500 defender play:die 700',
      '1500 defender fadeOut 700',
      '1500 audio play:die 0',
      '2300 attacker play:victory 600',
      '2900 attacker moveTo 400',
      '3000 camera restore 900',
    ]);
  });

  test('total duration is 3900 ms', () => {
    expect(sequenceDuration(seq)).toBe(3900);
  });

  test('the attacker stops half a unit short of the defender, then finishes on the captured square', () => {
    const approach = seq.steps.find((s) => s.kind === 'piece.moveTo' && s.at === 700);
    // e4 -> d5 is a diagonal, so the approach point is 0.5 along that diagonal before d5.
    const d5 = squareToWorld('d5');
    const e4 = squareToWorld('e4');
    const len = Math.hypot(d5.x - e4.x, d5.z - e4.z);
    expect(approach).toMatchObject({ to: { x: d5.x - ((d5.x - e4.x) / len) * 0.5, z: d5.z - ((d5.z - e4.z) / len) * 0.5 } });
    expect(seq.steps.find((s) => s.kind === 'piece.moveTo' && s.at === 2900)).toMatchObject({ to: 'd5' });
  });

  test('the impact effect and burst position come from the attacker side and the defender square', () => {
    const burst = seq.steps.find((s) => s.kind === 'effects.burst');
    expect(burst).toMatchObject({ effect: 'light', position: { x: squareToWorld('d5').x, z: squareToWorld('d5').z } });
    const fire = buildCaptureSequence(ctx(capture, { defenderId: 'def', impactEffect: 'fire' }));
    expect(fire.steps.find((s) => s.kind === 'effects.burst')).toMatchObject({ effect: 'fire' });
  });

  test('en passant aims at the captured pawn square but ends on the destination square', () => {
    const ep: MoveResult = { from: 'e5', to: 'd6', piece: pawn, captured: { piece: blackPawn, square: 'd5' }, san: 'exd6', check: false };
    const s = buildCaptureSequence(ctx(ep, { defenderId: 'def' }));
    expect(s.steps.find((x) => x.kind === 'effects.burst')).toMatchObject({ position: { x: squareToWorld('d5').x, z: squareToWorld('d5').z } });
    expect(s.steps.find((x) => x.kind === 'piece.moveTo' && x.at === 2900)).toMatchObject({ to: 'd6' });
  });

  test('a capture that gives check pulses the king as the attacker arrives, without extending the total', () => {
    const s = buildCaptureSequence(ctx({ ...capture, check: true }, { defenderId: 'def', checkedKingId: 'bk' }));
    expect(s.steps.find((x) => x.kind === 'piece.pulse')).toMatchObject({ at: 2900, id: 'bk', duration: 1000 });
    expect(sequenceDuration(s)).toBe(3900);
  });

  test('requires a capture and a defender', () => {
    expect(() => buildCaptureSequence(ctx(quiet))).toThrow(/capturing move/);
    expect(() => buildCaptureSequence(ctx(capture))).toThrow(/defender/);
  });
});

describe('slide sequences', () => {
  test('a quiet move is a single 350 ms slide', () => {
    expect(buildSlideSequence(ctx(quiet)).steps).toEqual([{ at: 0, duration: 350, kind: 'piece.moveTo', id: 'atk', to: 'e4' }]);
  });

  test('castling slides king and rook together', () => {
    const s = buildSlideSequence(ctx(castle, { rookId: 'rook' }));
    const moves = s.steps.filter((x) => x.kind === 'piece.moveTo');
    expect(moves).toEqual([
      { at: 0, duration: 350, kind: 'piece.moveTo', id: 'atk', to: 'g1' },
      { at: 0, duration: 350, kind: 'piece.moveTo', id: 'rook', to: 'f1' },
    ]);
  });

  test('a capture with cinematics off slides and fades the victim', () => {
    const s = buildSlideSequence(ctx(capture, { defenderId: 'def' }));
    expect(s.steps.some((x) => x.kind === 'piece.fadeOut' && x.id === 'def')).toBe(true);
    expect(sequenceDuration(s)).toBe(350);
  });

  test('check adds a one second pulse on the checked king', () => {
    const s = buildSlideSequence(ctx({ ...quiet, check: true }, { checkedKingId: 'bk' }));
    expect(s.steps).toContainEqual({ at: 0, duration: 1000, kind: 'piece.pulse', id: 'bk' });
    expect(sequenceDuration(s)).toBe(1000);
  });

  test('buildMoveSequence routes captures to the cinematic only when cinematics are on', () => {
    const c = ctx(capture, { defenderId: 'def' });
    expect(sequenceDuration(buildMoveSequence(c, true))).toBe(3900);
    expect(sequenceDuration(buildMoveSequence(c, false))).toBe(350);
    expect(sequenceDuration(buildMoveSequence(ctx(quiet), true))).toBe(350);
  });
});

describe('checkmate sequence', () => {
  test('orbits for six seconds while the losing king dies and fades', () => {
    const s = buildCheckmateSequence('wk');
    expect(s.steps.find((x) => x.kind === 'camera.orbit')).toMatchObject({ at: 0, duration: 6000 });
    expect(s.steps.find((x) => x.kind === 'piece.play')).toMatchObject({ id: 'wk', clip: 'die' });
    expect(s.steps.find((x) => x.kind === 'piece.fadeOut')).toMatchObject({ id: 'wk' });
    expect(sequenceDuration(s)).toBe(6000);
  });
});

describe('captureCameraPose', () => {
  test('frames the midpoint low and to the +z side for a horizontal attack', () => {
    const p = captureCameraPose('a4', 'c4');
    const mid = squareToWorld('b4');
    expect(p.target).toEqual({ x: mid.x, y: 0.45, z: mid.z });
    expect(p.position.y).toBeCloseTo(1.4);
    expect(p.position.z).toBeGreaterThan(mid.z + 2);
  });

  test('stays on the +z side for any attack direction that has a z component', () => {
    for (const [a, b] of [['e4', 'd5'], ['e4', 'f5'], ['e5', 'd4'], ['e5', 'f4']] as const) {
      const p = captureCameraPose(a, b);
      const mid = { x: (squareToWorld(a).x + squareToWorld(b).x) / 2, z: (squareToWorld(a).z + squareToWorld(b).z) / 2 };
      expect(p.position.z - mid.z).toBeGreaterThan(0);
    }
  });

  test('is always between 2 and 5 units from the target', () => {
    const p = captureCameraPose('a1', 'h8');
    const d = Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(8);
  });
});

test('running the default capture sequence at the fake clock ends the run at 3900 ms with every handle finished', async () => {
  const clock = createFakeClock();
  const { handles, calls } = createRecordingHandles(clock);
  const { done } = createSequencer(clock).run(buildCaptureSequence(ctx(capture, { defenderId: 'def' })), handles);
  clock.advance(3899);
  expect(calls.some((c) => c.method === 'finish')).toBe(false);
  clock.advance(1);
  await done;
  expect(calls.filter((c) => c.method === 'finish').map((c) => c.who)).toEqual(['piece', 'piece', 'camera']);
});
