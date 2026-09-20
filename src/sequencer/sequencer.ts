import type { PieceId } from '../core/types';
import type { Clock, Sequence, Sequencer, SequencerHandles, Step } from './types';

export const realClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function sequenceDuration(sequence: Sequence): number {
  return sequence.steps.reduce((end, s) => Math.max(end, s.at + s.duration), 0);
}

function pieceIds(steps: Step[]): PieceId[] {
  const ids = new Set<PieceId>();
  for (const s of steps) if ('id' in s) ids.add(s.id);
  return [...ids];
}

/** Applies one step. When `skipping`, the step jumps straight to its end state and never starts sounds, particles or clips. */
function apply(step: Step, h: SequencerHandles, skipping: boolean): void {
  const ms = skipping ? 0 : step.duration;
  switch (step.kind) {
    case 'camera.flyTo': return h.camera.flyTo(step.pose, ms);
    case 'camera.shake': return skipping ? undefined : h.camera.shake(ms, step.intensity);
    case 'camera.restore': return h.camera.restore(ms);
    case 'camera.orbit': return h.camera.orbit(ms, step.turns);
    case 'piece.play': return skipping ? undefined : h.piece(step.id).play(step.clip);
    case 'piece.moveTo': return h.piece(step.id).moveTo(step.to, ms);
    case 'piece.fadeOut': return h.piece(step.id).fadeOut(ms);
    case 'piece.pulse': return skipping ? undefined : h.piece(step.id).pulse(ms);
    case 'effects.burst': return skipping ? undefined : h.effects.burst(step.position, step.effect);
    case 'audio.play': return skipping ? undefined : h.audio.play(step.sound);
  }
}

export function createSequencer(clock: Clock = realClock): Sequencer {
  return {
    run(sequence, handles) {
      // Array.prototype.sort is stable, so steps with equal `at` keep their authored order.
      const steps = [...sequence.steps].sort((a, b) => a.at - b.at);
      const applied = steps.map(() => false);
      const timers: unknown[] = [];
      const ids = pieceIds(steps);
      const usesCamera = steps.some((s) => s.kind.startsWith('camera.'));
      let over = false;
      let resolve!: () => void;
      const done = new Promise<void>((r) => { resolve = r; });

      const guarded = (fn: () => void) => {
        try {
          fn();
        } catch (e) {
          // A broken handle must never stall the game.
          console.error('Sequence step failed', e);
        }
      };

      const finishHandles = () => {
        for (const id of ids) guarded(() => handles.piece(id).finish());
        if (usesCamera) guarded(() => handles.camera.finish());
      };

      const complete = () => {
        if (over) return;
        over = true;
        for (const t of timers) clock.clearTimeout(t);
        finishHandles();
        resolve();
      };

      for (const id of ids) guarded(() => handles.piece(id).hold());

      steps.forEach((step, i) => {
        const start = () => {
          applied[i] = true;
          guarded(() => apply(step, handles, false));
        };
        if (step.at <= 0) start();
        else timers.push(clock.setTimeout(start, step.at));
      });
      timers.push(clock.setTimeout(complete, sequenceDuration(sequence)));

      return {
        done,
        skip() {
          if (over) return;
          for (const t of timers) clock.clearTimeout(t);
          steps.forEach((step, i) => {
            if (applied[i]) return;
            applied[i] = true;
            guarded(() => apply(step, handles, true));
          });
          complete();
        },
      };
    },
  };
}
