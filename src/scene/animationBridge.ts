import type { ControllerStore } from '../controller/store';

const DEFAULT_DELAYS = { moveMs: 350, cinematicMs: 4000 };

/** Plan 1 stand-in for the sequencer: completes moves after a fixed delay. */
export function startAnimationBridge(store: ControllerStore, delays = DEFAULT_DELAYS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.phase === prev.phase) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (s.phase === 'animatingMove' || s.phase === 'cinematic') {
      const ms = s.phase === 'cinematic' ? delays.cinematicMs : delays.moveMs;
      timer = setTimeout(() => {
        timer = null;
        store.getState().actions.animationDone();
      }, ms);
    }
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
