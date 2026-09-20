import { createAudioEngine, type AudioContextLike } from './audioEngine';

function fakeContext() {
  const started: unknown[] = [];
  const ctx: AudioContextLike & { started: unknown[]; running: boolean } = {
    started,
    running: false,
    get state() { return ctx.running ? 'running' : 'suspended'; },
    destination: 'dest',
    resume: async () => { ctx.running = true; },
    close: async () => {},
    decodeAudioData: async (d) => ({ decoded: d }),
    createBufferSource: () => ({ buffer: null, connect() {}, start() { started.push(1); } }),
  };
  return ctx;
}

const okFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });

function setup(enabled = () => true, fetchFn: any = okFetch) {
  const ctx = fakeContext();
  const target = new EventTarget();
  const createContext = vi.fn(() => ctx);
  const engine = createAudioEngine({ urls: { attack: '/a.wav', hit: '/h.wav' }, isEnabled: enabled, createContext, fetchFn, gestureTarget: target });
  return { ctx, target, engine, createContext };
}

test('stays silent and creates no context before the first gesture, without errors', () => {
  const { engine, ctx, createContext } = setup();
  expect(() => engine.play('attack')).not.toThrow();
  expect(createContext).not.toHaveBeenCalled();
  expect(ctx.started).toHaveLength(0);
});

test('the first pointerdown unlocks audio and later plays are audible', async () => {
  const { engine, ctx, target, createContext } = setup();
  target.dispatchEvent(new Event('pointerdown'));
  await engine.unlock();
  expect(createContext).toHaveBeenCalledTimes(1);
  engine.play('attack');
  engine.play('hit');
  expect(ctx.started).toHaveLength(2);
});

test('a key press also unlocks, and unlocking happens only once', async () => {
  const { engine, target, createContext } = setup();
  target.dispatchEvent(new Event('keydown'));
  target.dispatchEvent(new Event('pointerdown'));
  await engine.unlock();
  expect(createContext).toHaveBeenCalledTimes(1);
});

test('the Sound setting is read at play time', async () => {
  let on = true;
  const { engine, ctx } = setup(() => on);
  await engine.unlock();
  on = false;
  engine.play('attack');
  expect(ctx.started).toHaveLength(0);
  on = true;
  engine.play('attack');
  expect(ctx.started).toHaveLength(1);
});

test('a sound the set does not provide is silently skipped', async () => {
  const { engine, ctx } = setup();
  await engine.unlock();
  engine.play('die');
  expect(ctx.started).toHaveLength(0);
});

test('a sound that fails to load warns once and the others still play', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fetchFn = async (url: string) => (url === '/a.wav' ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : okFetch());
  const { engine, ctx } = setup(() => true, fetchFn);
  await engine.unlock();
  engine.play('attack');
  engine.play('hit');
  expect(ctx.started).toHaveLength(1);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('if the context cannot be created, unlock warns and play stays silent', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = createAudioEngine({ urls: { attack: '/a.wav' }, isEnabled: () => true, createContext: () => { throw new Error('no audio'); }, gestureTarget: new EventTarget() });
  await engine.unlock();
  expect(() => engine.play('attack')).not.toThrow();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test('dispose stops listening for gestures', async () => {
  const { engine, target, createContext } = setup();
  engine.dispose();
  target.dispatchEvent(new Event('pointerdown'));
  await Promise.resolve();
  expect(createContext).not.toHaveBeenCalled();
});
