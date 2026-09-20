import { createGameCore } from './core/gameCore';
import { createEngine, type Engine } from './engine/engine';
import { stockfishWorkerFactory } from './engine/stockfishWorker';
import { createController, type ControllerStore } from './controller/store';
import { loadSettings } from './controller/settings';

declare global {
  interface Window {
    __chess3d?: ControllerStore;
  }
}

export function createAppStore(): ControllerStore {
  let engine: Engine | null = null;
  try {
    engine = createEngine(stockfishWorkerFactory);
  } catch (e) {
    console.warn('Engine could not be created', e);
  }
  const store = createController({ core: createGameCore(), engine, settings: loadSettings() });
  if (import.meta.env.DEV) window.__chess3d = store;
  return store;
}

let appStore: ControllerStore | null = null;

/**
 * Module-level lazy singleton. React StrictMode double-invokes initializers in dev, which would
 * otherwise create two stores (and two Stockfish workers) with window.__chess3d left pointing
 * at the discarded one.
 */
export function getAppStore(): ControllerStore {
  appStore ??= createAppStore();
  return appStore;
}
