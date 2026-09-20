import { createController } from '../controller/store';
import { createGameCore } from '../core/gameCore';
import { startSequenceDriver } from './driver';
import { createSequencer } from './sequencer';
import { createFakeClock, createRecordingHandles } from './testing';
import type { Sequencer } from './types';

function setup(fen?: string, settings?: { cinematics: boolean }) {
  const clock = createFakeClock();
  const { handles, calls } = createRecordingHandles(clock);
  const store = createController({
    core: createGameCore(fen),
    engine: null,
    saveSettings: () => {},
    settings: { skill: 5, cinematics: settings?.cinematics ?? true, sound: true, twoPlayer: false },
  });
  const stop = startSequenceDriver({ store, handles, sequencer: createSequencer(clock), impactEffect: (c) => (c === 'w' ? 'light' : 'fire') });
  const a = store.getState().actions;
  const play = (from: string, to: string) => { a.clickSquare(from as never); a.clickSquare(to as never); };
  const flush = () => Promise.resolve().then(() => Promise.resolve());
  return { clock, calls, store, stop, a, play, flush };
}

const CAPTURE_FEN = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

test('a quiet move slides the piece, then returns control after 350 ms', async () => {
  const { clock, calls, store, play, flush } = setup();
  play('e2', 'e4');
  expect(store.getState().phase).toBe('animatingMove');
  expect(calls.find((c) => c.method === 'moveTo')).toMatchObject({ id: 'w-p-4', to: 'e4', ms: 350 });
  clock.advance(349);
  await flush();
  expect(store.getState().phase).toBe('animatingMove');
  clock.advance(1);
  await flush();
  expect(store.getState().phase).toBe('idle');
});

test('a capture plays the 3900 ms cinematic and hands the right ids to the sequence', async () => {
  const { clock, calls, store, play, flush } = setup(CAPTURE_FEN);
  play('e4', 'd5');
  expect(store.getState().phase).toBe('cinematic');
  expect(calls.find((c) => c.method === 'flyTo')).toBeDefined();
  clock.advance(3899);
  await flush();
  expect(store.getState().phase).toBe('cinematic');
  clock.advance(1);
  await flush();
  expect(store.getState().phase).toBe('idle');
  const burst = calls.find((c) => c.method === 'burst');
  expect(burst).toMatchObject({ effect: 'light' });
  const die = calls.find((c) => c.method === 'play' && (c as { clip?: string }).clip === 'die') as { id: string };
  expect(store.getState().pieces[die.id]).toMatchObject({ captured: true });
});

test('skipping the cinematic finishes the handles immediately and does not call animationDone twice', async () => {
  const { clock, calls, store, play, a, flush } = setup(CAPTURE_FEN);
  play('e4', 'd5');
  clock.advance(1000);
  calls.length = 0;
  a.skipCinematic();
  expect(store.getState().phase).toBe('idle');
  expect(calls.filter((c) => c.method === 'finish').length).toBeGreaterThan(0);
  clock.advance(10000);
  await flush();
  expect(store.getState().phase).toBe('idle');
  expect(store.getState().history).toHaveLength(2 - 1); // the FEN position starts with no history; only exd5 was played
});

test('with cinematics off a capture is a plain slide plus a fade of the victim', async () => {
  const { clock, calls, store, play, flush } = setup(CAPTURE_FEN, { cinematics: false });
  play('e4', 'd5');
  expect(store.getState().phase).toBe('animatingMove');
  clock.advance(150);
  expect(calls.some((c) => c.method === 'fadeOut')).toBe(true);
  clock.advance(200);
  await flush();
  expect(store.getState().phase).toBe('idle');
});

test('castling slides both king and rook', () => {
  const { calls, play, a } = setup('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  a.clickSquare('e1');
  a.clickSquare('g1');
  const moves = calls.filter((c) => c.method === 'moveTo') as { id: string; to: string }[];
  expect(moves.map((m) => m.to).sort()).toEqual(['f1', 'g1']);
  void play;
});

test('a move that gives check pulses the checked king', () => {
  const { calls, play } = setup('4k3/8/8/8/8/8/8/4K2R w - - 0 1');
  play('h1', 'h8');
  expect(calls.find((c) => c.method === 'pulse')).toMatchObject({ id: 'b-k-0', ms: 1000 });
});

test('checkmate starts the orbit sequence; new game skips it and resets the scene', async () => {
  const { clock, calls, store, play, a, flush } = setup();
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    play(f!, t!);
    clock.advance(1100); // the mating move also plays the 1 s check pulse
    await flush();
  }
  expect(store.getState().phase).toBe('gameOver');
  expect(calls.find((c) => c.method === 'orbit')).toMatchObject({ ms: 6000 });
  clock.advance(300);
  expect(calls.find((c) => c.method === 'play' && (c as { clip?: string }).clip === 'die')).toMatchObject({ id: 'w-k-0' });
  calls.length = 0;
  a.newGame();
  expect(calls.some((c) => c.who === 'all' && c.method === 'reset')).toBe(true);
  expect(store.getState().phase).toBe('idle');
});

test('undo out of checkmate also resets the scene', async () => {
  const { clock, calls, play, a, flush } = setup();
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    play(f!, t!);
    clock.advance(1100); // the mating move also plays the 1 s check pulse
    await flush();
  }
  calls.length = 0;
  a.undo();
  expect(calls.some((c) => c.who === 'all' && c.method === 'reset')).toBe(true);
});

test('starting a new game mid-animation skips the running sequence', async () => {
  const { clock, calls, store, play, a, flush } = setup();
  play('e2', 'e4');
  calls.length = 0;
  a.newGame();
  expect(calls.some((c) => c.method === 'finish')).toBe(true);
  clock.advance(1000);
  await flush();
  expect(store.getState().phase).toBe('idle');
  expect(store.getState().history).toHaveLength(0);
});

test('if the sequencer throws, the move still completes', () => {
  const clock = createFakeClock();
  const { handles } = createRecordingHandles(clock);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const broken: Sequencer = { run: () => { throw new Error('boom'); } };
  const store = createController({ core: createGameCore(), engine: null, saveSettings: () => {} });
  startSequenceDriver({ store, handles, sequencer: broken, impactEffect: () => 'light' });
  store.getState().actions.clickSquare('e2');
  store.getState().actions.clickSquare('e4');
  expect(store.getState().phase).toBe('idle');
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

test('stopping the driver unsubscribes and skips anything running', () => {
  const { calls, stop, play } = setup();
  play('e2', 'e4');
  calls.length = 0;
  stop();
  expect(calls.some((c) => c.method === 'finish')).toBe(true);
});
