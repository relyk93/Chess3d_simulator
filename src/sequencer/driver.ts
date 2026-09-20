import type { ControllerStore, Phase } from '../controller/store';
import type { Color } from '../core/types';
import { moveContextFromState, kingIdOf } from './context';
import { createSequencer } from './sequencer';
import { buildCheckmateSequence, buildMoveSequence } from './sequences';
import type { ImpactEffect, Sequencer, SequencerHandles } from './types';

export interface DriverDeps {
  store: ControllerStore;
  handles: SequencerHandles;
  /** Impact style for an attacker of the given side (from the set manifest). */
  impactEffect: (side: Color) => ImpactEffect;
  sequencer?: Sequencer;
}

const isMoving = (p: Phase): boolean => p === 'animatingMove' || p === 'cinematic';

/**
 * Replaces Plan 1's animation bridge. Watches the controller phase, plays the matching sequence on the
 * scene handles, and calls `animationDone()` when a move sequence finishes. A phase change that arrives
 * first (skip, new game) skips the running sequence so the scene lands in the controller's state.
 */
export function startSequenceDriver({ store, handles, impactEffect, sequencer = createSequencer() }: DriverDeps): () => void {
  let moveRun: { skip(): void } | null = null;
  let endingRun: { skip(): void } | null = null;
  let endingShown = false;

  function stopMove() {
    const r = moveRun;
    moveRun = null;
    r?.skip();
  }

  function stopEnding() {
    endingRun?.skip();
    endingRun = null;
    if (endingShown) {
      endingShown = false;
      handles.reset();
    }
  }

  function startMove(s: ReturnType<ControllerStore['getState']>) {
    const ctx = moveContextFromState(s, impactEffect);
    if (!ctx) {
      console.error('Sequence driver: no consistent last move, skipping animation');
      s.actions.animationDone();
      return;
    }
    try {
      const run = sequencer.run(buildMoveSequence(ctx, s.phase === 'cinematic'), handles);
      moveRun = run;
      void run.done.then(() => {
        if (moveRun !== run) return; // skipped or superseded
        moveRun = null;
        store.getState().actions.animationDone();
      });
    } catch (e) {
      console.error('Sequence driver: sequence failed to start', e);
      moveRun = null;
      s.actions.animationDone();
    }
  }

  function startEnding(s: ReturnType<ControllerStore['getState']>) {
    const kingId = kingIdOf(s.pieces, s.turn);
    if (!kingId) return;
    try {
      endingShown = true;
      endingRun = sequencer.run(buildCheckmateSequence(kingId), handles);
    } catch (e) {
      console.error('Sequence driver: checkmate sequence failed', e);
    }
  }

  const unsubscribe = store.subscribe((s, prev) => {
    if (!isMoving(s.phase)) stopMove();
    if (prev.phase === 'gameOver' && s.phase !== 'gameOver') stopEnding();
    if (isMoving(s.phase) && (!isMoving(prev.phase) || s.lastMove !== prev.lastMove)) startMove(s);
    if (s.phase === 'gameOver' && prev.phase !== 'gameOver' && s.gameOver === 'checkmate') startEnding(s);
  });

  return () => {
    unsubscribe();
    stopMove();
    stopEnding();
  };
}
