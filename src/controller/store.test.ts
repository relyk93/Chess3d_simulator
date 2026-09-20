import { createGameCore } from '../core/gameCore';
import type { Engine } from '../engine/engine';
import type { MoveRequest } from '../core/types';
import { DEFAULT_SETTINGS } from './settings';
import { createController, type ControllerStore } from './store';
import { pieceIdAt } from './pieceTracker';

class FakeEngine implements Engine {
  skill: number | null = null;
  stops = 0;
  searches: string[] = [];
  private pending: { res: (m: MoveRequest) => void; rej: (e: Error) => void } | null = null;
  private readyRes!: () => void;
  private readyRej!: (e: Error) => void;
  private readyP = new Promise<void>((res, rej) => { this.readyRes = res; this.readyRej = rej; });
  ready() { return this.readyP; }
  becomeReady() { this.readyRes(); }
  failToStart() { this.readyRej(new Error('boom')); }
  setSkill(l: number) { this.skill = l; }
  bestMove(fen: string) {
    this.searches.push(fen);
    return new Promise<MoveRequest>((res, rej) => { this.pending = { res, rej }; });
  }
  reply(m: MoveRequest) { const p = this.pending; this.pending = null; p?.res(m); }
  fail(msg = 'engine crashed') { const p = this.pending; this.pending = null; p?.rej(new Error(msg)); }
  stop() { this.stops++; const p = this.pending; this.pending = null; p?.rej(new Error('Engine search stopped')); }
  dispose() {}
  get isSearching() { return this.pending !== null; }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function setup(fen?: string, settings = { ...DEFAULT_SETTINGS }) {
  const core = createGameCore(fen);
  const engine = new FakeEngine();
  const saved: unknown[] = [];
  const store = createController({ core, engine, settings, saveSettings: (s) => saved.push(s) });
  engine.becomeReady();
  await flush();
  return { core, engine, store, saved, a: store.getState().actions };
}

function state(store: ControllerStore) { return store.getState(); }

describe('createController', () => {
  test('initial state and engine readiness', async () => {
    const { store, engine } = await setup();
    expect(state(store).phase).toBe('idle');
    expect(Object.keys(state(store).pieces)).toHaveLength(32);
    expect(state(store).turn).toBe('w');
    expect(state(store).engineStatus).toBe('ready');
    expect(engine.skill).toBe(DEFAULT_SETTINGS.skill);
  });

  test('selection: own piece selects, same square deselects, other own piece reselects, illegal clears', async () => {
    const { store, a } = await setup();
    a.clickSquare('e2');
    expect(state(store)).toMatchObject({ phase: 'selected', selected: 'e2' });
    expect(state(store).legalTargets.sort()).toEqual(['e3', 'e4']);
    a.clickSquare('e2');
    expect(state(store)).toMatchObject({ phase: 'idle', selected: null, legalTargets: [] });
    a.clickSquare('d2');
    a.clickSquare('g1');
    expect(state(store)).toMatchObject({ phase: 'selected', selected: 'g1' });
    a.clickSquare('h5');
    expect(state(store).phase).toBe('idle');
  });

  test('clicking an opponent piece in idle does nothing', async () => {
    const { store, a } = await setup();
    a.clickSquare('e7');
    expect(state(store).phase).toBe('idle');
  });

  test('full human move then engine reply cycle', async () => {
    const { store, a, engine, core } = await setup();
    const pawn = pieceIdAt(state(store).pieces, 'e2')!;
    a.clickSquare('e2');
    a.clickSquare('e4');
    expect(state(store).phase).toBe('animatingMove');
    expect(state(store).pieces[pawn]?.square).toBe('e4');
    expect(state(store).lastMove?.san).toBe('e4');
    expect(engine.isSearching).toBe(false);

    a.animationDone();
    expect(state(store).phase).toBe('engineThinking');
    expect(engine.searches).toEqual([core.fen()]);

    engine.reply({ from: 'e7', to: 'e5' });
    await flush();
    expect(state(store).phase).toBe('animatingMove');
    expect(state(store).history.map((m) => m.san)).toEqual(['e4', 'e5']);

    a.animationDone();
    expect(state(store).phase).toBe('idle');
    expect(state(store).turn).toBe('w');
  });

  test('captures enter cinematic when enabled and animatingMove when disabled', async () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const on = await setup(fen);
    on.a.clickSquare('e4'); on.a.clickSquare('d5');
    expect(state(on.store).phase).toBe('cinematic');
    on.a.skipCinematic();
    expect(state(on.store).phase).toBe('engineThinking');

    const off = await setup(fen, { ...DEFAULT_SETTINGS, cinematics: false });
    off.a.clickSquare('e4'); off.a.clickSquare('d5');
    expect(state(off.store).phase).toBe('animatingMove');
  });

  test('clicks are ignored while busy', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4');
    a.clickSquare('d2');
    expect(state(store)).toMatchObject({ phase: 'animatingMove', selected: null });
    a.animationDone();
    a.clickSquare('d2');
    expect(state(store)).toMatchObject({ phase: 'engineThinking', selected: null });
    engine.reply({ from: 'e7', to: 'e5' });
    await flush();
    a.animationDone();
    expect(state(store).phase).toBe('idle');
  });

  test('promotion flow: promoting, cancel, choose', async () => {
    const { store, a } = await setup('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const pawn = pieceIdAt(state(store).pieces, 'a7')!;
    a.clickSquare('a7'); a.clickSquare('a8');
    expect(state(store)).toMatchObject({ phase: 'promoting', pendingPromotion: { from: 'a7', to: 'a8' } });
    a.clickSquare('h1');
    expect(state(store).phase).toBe('promoting');
    a.cancelPromotion();
    expect(state(store)).toMatchObject({ phase: 'selected', selected: 'a7', pendingPromotion: null });
    a.clickSquare('a8');
    a.choosePromotion('q');
    expect(state(store).phase).toBe('animatingMove');
    expect(state(store).pieces[pawn]?.piece.type).toBe('q');
  });

  test('checkmate ends the game; newGame resets', async () => {
    const { store, a } = await setup('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    a.clickSquare('h5'); a.clickSquare('f7');
    a.skipCinematic();
    expect(state(store)).toMatchObject({ phase: 'gameOver', gameOver: 'checkmate' });
    a.clickSquare('e2');
    expect(state(store).phase).toBe('gameOver');
    a.newGame();
    expect(state(store)).toMatchObject({ phase: 'idle', gameOver: null, history: [], lastMove: null });
    expect(Object.keys(state(store).pieces)).toHaveLength(32);
  });

  test('undo after an engine reply undoes both moves', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    engine.reply({ from: 'e7', to: 'e5' }); await flush(); a.animationDone();
    a.undo();
    expect(state(store)).toMatchObject({ phase: 'idle', turn: 'w', history: [] });
    expect(pieceIdAt(state(store).pieces, 'e2')).not.toBeNull();
    expect(pieceIdAt(state(store).pieces, 'e7')).not.toBeNull();
  });

  test('undo while the engine thinks stops it and ignores the stale reply', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    expect(state(store).phase).toBe('engineThinking');
    a.undo();
    expect(engine.stops).toBe(1);
    expect(state(store)).toMatchObject({ phase: 'idle', turn: 'w', history: [] });
    await flush();
    expect(state(store).phase).toBe('idle');
  });

  test('engine failing to start enables two-player mode', async () => {
    const core = createGameCore();
    const engine = new FakeEngine();
    const saved: unknown[] = [];
    const store = createController({ core, engine, saveSettings: (s) => saved.push(s) });
    engine.failToStart();
    await flush();
    expect(state(store).engineStatus).toBe('failed');
    expect(state(store).settings.twoPlayer).toBe(true);
    expect(saved).toHaveLength(1);
    const a = state(store).actions;
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    expect(state(store).phase).toBe('idle');
    a.clickSquare('e7'); a.clickSquare('e5'); a.animationDone();
    expect(state(store).phase).toBe('idle');
    expect(engine.searches).toEqual([]);
  });

  test('engine search failure is retried once, then falls back to two-player', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    engine.fail(); await flush();
    expect(state(store).phase).toBe('engineThinking');
    expect(engine.searches).toHaveLength(2);
    engine.fail(); await flush();
    expect(state(store)).toMatchObject({ phase: 'idle', engineStatus: 'failed' });
    expect(state(store).settings.twoPlayer).toBe(true);
  });

  test('updateSettings saves, forwards skill, and wakes the engine when two-player is turned off', async () => {
    const { store, a, engine, saved } = await setup();
    a.updateSettings({ skill: 12 });
    expect(engine.skill).toBe(12);
    expect(saved.at(-1)).toMatchObject({ skill: 12 });
    a.updateSettings({ twoPlayer: true });
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    expect(state(store).phase).toBe('idle');
    a.updateSettings({ twoPlayer: false });
    expect(state(store).phase).toBe('engineThinking');
  });
});
