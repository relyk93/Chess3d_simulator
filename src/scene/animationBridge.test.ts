import { createGameCore } from '../core/gameCore';
import { createController } from '../controller/store';
import { startAnimationBridge } from './animationBridge';

test('bridge calls animationDone after the move delay', () => {
  vi.useFakeTimers();
  const store = createController({ core: createGameCore(), engine: null, saveSettings: () => {} });
  const stop = startAnimationBridge(store, { moveMs: 350, cinematicMs: 4000 });
  const a = store.getState().actions;
  a.clickSquare('e2'); a.clickSquare('e4');
  expect(store.getState().phase).toBe('animatingMove');
  vi.advanceTimersByTime(349);
  expect(store.getState().phase).toBe('animatingMove');
  vi.advanceTimersByTime(1);
  expect(store.getState().phase).toBe('idle');   // no engine -> idle
  stop();
  vi.useRealTimers();
});

test('bridge uses the cinematic delay for captures and is cancelled by stop()', () => {
  vi.useFakeTimers();
  const core = createGameCore('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const store = createController({ core, engine: null, saveSettings: () => {} });
  const stop = startAnimationBridge(store, { moveMs: 350, cinematicMs: 4000 });
  const a = store.getState().actions;
  a.clickSquare('e4'); a.clickSquare('d5');
  expect(store.getState().phase).toBe('cinematic');
  vi.advanceTimersByTime(3999);
  expect(store.getState().phase).toBe('cinematic');
  stop();
  vi.advanceTimersByTime(10);
  expect(store.getState().phase).toBe('cinematic');
  vi.useRealTimers();
});
