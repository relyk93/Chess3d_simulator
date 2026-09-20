import { createEngine, type EngineWorker } from './engine';

class FakeWorker implements EngineWorker {
  sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  terminated = false;
  postMessage(msg: string) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line }); }
}

function boot() {
  const w = new FakeWorker();
  const engine = createEngine(() => w, { readyTimeoutMs: 10_000 });
  return { w, engine };
}

async function bootReady() {
  const { w, engine } = boot();
  const ready = engine.ready();
  w.emit('uciok');
  w.emit('readyok');
  await ready;
  return { w, engine };
}

describe('createEngine', () => {
  test('handshake: posts uci, then isready after uciok, resolves ready on readyok', async () => {
    const { w, engine } = boot();
    const ready = engine.ready();
    expect(w.sent).toEqual(['uci']);
    w.emit('id name Stockfish 16');
    w.emit('uciok');
    expect(w.sent).toEqual(['uci', 'isready']);
    w.emit('readyok');
    await expect(ready).resolves.toBeUndefined();
  });

  test('ready rejects when the handshake exceeds the timeout', async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const engine = createEngine(() => w, { readyTimeoutMs: 500 });
    const ready = engine.ready();
    vi.advanceTimersByTime(501);
    await expect(ready).rejects.toThrow(/timed out/i);
    vi.useRealTimers();
  });

  test('setSkill posts the UCI option, clamped to 0..20', async () => {
    const { w, engine } = await bootReady();
    engine.setSkill(7);
    engine.setSkill(99);
    engine.setSkill(-3);
    expect(w.sent.slice(-3)).toEqual([
      'setoption name Skill Level value 7',
      'setoption name Skill Level value 20',
      'setoption name Skill Level value 0',
    ]);
  });

  test('bestMove posts position and go, parses a plain move', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('startfen', 1500);
    expect(w.sent.slice(-2)).toEqual(['position fen startfen', 'go movetime 1500']);
    w.emit('info depth 1 score cp 20');
    w.emit('bestmove e2e4 ponder e7e5');
    await expect(p).resolves.toEqual({ from: 'e2', to: 'e4' });
  });

  test('bestMove parses a promotion', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('f', 100);
    w.emit('bestmove a7a8q');
    await expect(p).resolves.toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  test('bestmove (none) rejects', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('f', 100);
    w.emit('bestmove (none)');
    await expect(p).rejects.toThrow(/no move/i);
  });

  test('stop posts stop and rejects the pending bestMove', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('f', 100);
    engine.stop();
    expect(w.sent.at(-1)).toBe('stop');
    await expect(p).rejects.toThrow(/stopped/i);
  });

  test('a second bestMove while one is pending rejects', async () => {
    const { w, engine } = await bootReady();
    const first = engine.bestMove('f', 100);
    await expect(engine.bestMove('f', 100)).rejects.toThrow(/pending/i);
    w.emit('bestmove e2e4');
    await first;
  });

  test('dispose terminates the worker', async () => {
    const { w, engine } = await bootReady();
    engine.dispose();
    expect(w.terminated).toBe(true);
  });
});
