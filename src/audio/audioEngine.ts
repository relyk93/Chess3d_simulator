import type { AudioHandle, SoundName } from '../sequencer/types';

/** The slice of the Web Audio API the engine uses, so tests can supply a fake. */
export interface AudioContextLike {
  readonly state: 'suspended' | 'running' | 'closed';
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  createBufferSource(): { buffer: unknown; connect(node: unknown): void; start(): void };
}

export interface AudioEngineOptions {
  /** Absolute URLs of the sounds this set provides; missing keys are simply silent. */
  urls: Partial<Record<SoundName, string>>;
  /** Read at play time so the Sound setting takes effect immediately. */
  isEnabled: () => boolean;
  createContext?: () => AudioContextLike;
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Where to listen for the first user gesture. Defaults to `window`. */
  gestureTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

export interface AudioEngine extends AudioHandle {
  /** Creates and resumes the context and loads the sounds. Called automatically on the first click or key press. */
  unlock(): Promise<void>;
  dispose(): void;
}

const GESTURES = ['pointerdown', 'keydown'] as const;

/**
 * Browsers block audio until the user interacts with the page. Until then `play` does nothing and raises no error
 * (spec section 10). The first pointer or key event creates the context, and later plays are audible.
 */
export function createAudioEngine(opts: AudioEngineOptions): AudioEngine {
  const target = opts.gestureTarget ?? (typeof window === 'undefined' ? undefined : window);
  const make = opts.createContext ?? (() => new AudioContext() as unknown as AudioContextLike);
  const fetchFn = opts.fetchFn ?? ((u: string) => fetch(u));
  const buffers = new Map<SoundName, unknown>();
  let ctx: AudioContextLike | null = null;
  let unlocking: Promise<void> | null = null;
  let disposed = false;

  const onGesture = () => void engine.unlock();
  for (const g of GESTURES) target?.addEventListener(g, onGesture);
  const detach = () => { for (const g of GESTURES) target?.removeEventListener(g, onGesture); };

  async function loadSound(context: AudioContextLike, name: SoundName, url: string): Promise<void> {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffers.set(name, await context.decodeAudioData(await res.arrayBuffer()));
    } catch (e) {
      console.warn(`Sound "${name}" failed to load from ${url}`, e);
    }
  }

  const engine: AudioEngine = {
    unlock() {
      unlocking ??= (async () => {
        detach();
        if (disposed) return;
        try {
          const context = make();
          ctx = context;
          await context.resume();
          await Promise.all(Object.entries(opts.urls).map(([n, u]) => (u ? loadSound(context, n as SoundName, u) : undefined)));
        } catch (e) {
          console.warn('Audio could not start; continuing without sound', e);
        }
      })();
      return unlocking;
    },
    play(sound) {
      if (!ctx || ctx.state !== 'running' || !opts.isEnabled()) return;
      const buffer = buffers.get(sound);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    },
    dispose() {
      disposed = true;
      detach();
      void ctx?.close().catch(() => {});
      ctx = null;
      buffers.clear();
    },
  };
  return engine;
}
