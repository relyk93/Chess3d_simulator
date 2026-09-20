import type { PieceId } from '../core/types';
import type { CameraPose, Clock, ClipName, ImpactEffect, Point2, SequencerHandles, SoundName, Vec3 } from './types';
import type { Square } from '../core/types';

/** Deterministic clock: nothing fires until `advance` is called. Equal deadlines fire in scheduling order. */
export function createFakeClock(): Clock & { advance(ms: number): void; now(): number } {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextKey: number | null = null;
        for (const [k, t] of timers) {
          if (t.at <= target && (nextKey === null || t.at < timers.get(nextKey)!.at)) nextKey = k;
        }
        if (nextKey === null) break;
        const t = timers.get(nextKey)!;
        timers.delete(nextKey);
        now = Math.max(now, t.at);
        t.fn();
      }
      now = target;
    },
  };
}

export type Call =
  | { t: number; who: 'camera'; method: 'flyTo'; pose: CameraPose; ms: number }
  | { t: number; who: 'camera'; method: 'shake'; ms: number; intensity: number }
  | { t: number; who: 'camera'; method: 'restore' | 'finish' | 'reset'; ms?: number }
  | { t: number; who: 'camera'; method: 'orbit'; ms: number; turns: number }
  | { t: number; who: 'piece'; id: PieceId; method: 'play'; clip: ClipName }
  | { t: number; who: 'piece'; id: PieceId; method: 'moveTo'; to: Square | Point2; ms: number }
  | { t: number; who: 'piece'; id: PieceId; method: 'fadeOut' | 'pulse'; ms: number }
  | { t: number; who: 'piece'; id: PieceId; method: 'hold' | 'finish' | 'reset' }
  | { t: number; who: 'effects'; method: 'burst'; position: Vec3; effect: ImpactEffect }
  | { t: number; who: 'audio'; method: 'play'; sound: SoundName }
  | { t: number; who: 'all'; method: 'reset' };

/** Handles that record every call with the fake clock's time, for asserting order and timing. */
export function createRecordingHandles(clock: { now(): number }): { handles: SequencerHandles; calls: Call[] } {
  const calls: Call[] = [];
  const t = () => clock.now();
  const handles: SequencerHandles = {
    piece: (id) => ({
      play: (clip) => calls.push({ t: t(), who: 'piece', id, method: 'play', clip }),
      moveTo: (to, ms) => calls.push({ t: t(), who: 'piece', id, method: 'moveTo', to, ms }),
      fadeOut: (ms) => calls.push({ t: t(), who: 'piece', id, method: 'fadeOut', ms }),
      pulse: (ms) => calls.push({ t: t(), who: 'piece', id, method: 'pulse', ms }),
      hold: () => calls.push({ t: t(), who: 'piece', id, method: 'hold' }),
      finish: () => calls.push({ t: t(), who: 'piece', id, method: 'finish' }),
      reset: () => calls.push({ t: t(), who: 'piece', id, method: 'reset' }),
      snapshot: () => ({ x: 0, z: 0, visible: true }),
    }),
    camera: {
      flyTo: (pose, ms) => calls.push({ t: t(), who: 'camera', method: 'flyTo', pose, ms }),
      shake: (ms, intensity) => calls.push({ t: t(), who: 'camera', method: 'shake', ms, intensity }),
      restore: (ms) => calls.push({ t: t(), who: 'camera', method: 'restore', ms }),
      orbit: (ms, turns) => calls.push({ t: t(), who: 'camera', method: 'orbit', ms, turns }),
      finish: () => calls.push({ t: t(), who: 'camera', method: 'finish' }),
      reset: () => calls.push({ t: t(), who: 'camera', method: 'reset' }),
    },
    effects: { burst: (position, effect) => calls.push({ t: t(), who: 'effects', method: 'burst', position, effect }) },
    audio: { play: (sound) => calls.push({ t: t(), who: 'audio', method: 'play', sound }) },
    reset: () => calls.push({ t: t(), who: 'all', method: 'reset' }),
  };
  return { handles, calls };
}
