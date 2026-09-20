import type { MoveRequest, PromotionPiece, Square } from '../core/types';

export interface EngineWorker {
  postMessage(msg: string): void;
  onmessage: ((ev: { data: string }) => void) | null;
  terminate(): void;
}

export type WorkerFactory = () => EngineWorker;

export interface Engine {
  ready(): Promise<void>;
  setSkill(level: number): void;
  bestMove(fen: string, moveTimeMs: number): Promise<MoveRequest>;
  stop(): void;
  dispose(): void;
}

interface Pending {
  resolve: (m: MoveRequest) => void;
  reject: (e: Error) => void;
}

export function parseBestMove(line: string): MoveRequest | null {
  const token = line.split(/\s+/)[1];
  if (!token || token === '(none)') return null;
  const from = token.slice(0, 2) as Square;
  const to = token.slice(2, 4) as Square;
  const promotion = token[4] as PromotionPiece | undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

export function createEngine(factory: WorkerFactory, opts: { readyTimeoutMs?: number } = {}): Engine {
  const readyTimeoutMs = opts.readyTimeoutMs ?? 10_000;
  const worker = factory();
  let pending: Pending | null = null;
  // Every `go` yields exactly one `bestmove`, even when interrupted by `stop`. Count the
  // ones we abandoned so their late lines are not mistaken for the next request's answer.
  let staleBestmoves = 0;
  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  readyPromise.catch(() => {}); // avoid unhandled rejection when nobody awaits ready()

  const timer = setTimeout(() => rejectReady(new Error('Engine timed out during UCI handshake')), readyTimeoutMs);

  worker.onmessage = (ev) => {
    const line = String(ev.data);
    if (line === 'uciok') {
      worker.postMessage('isready');
    } else if (line === 'readyok') {
      clearTimeout(timer);
      resolveReady();
    } else if (line.startsWith('bestmove')) {
      if (staleBestmoves > 0) {
        staleBestmoves--;
        return;
      }
      const p = pending;
      pending = null;
      if (!p) return;
      const m = parseBestMove(line);
      if (m) p.resolve(m);
      else p.reject(new Error('Engine returned no move'));
    }
  };

  worker.postMessage('uci');

  return {
    ready: () => readyPromise,
    setSkill(level) {
      const clamped = Math.max(0, Math.min(20, Math.round(level)));
      worker.postMessage(`setoption name Skill Level value ${clamped}`);
    },
    bestMove(fen, moveTimeMs) {
      if (pending) return Promise.reject(new Error('A bestMove request is already pending'));
      return new Promise<MoveRequest>((resolve, reject) => {
        pending = { resolve, reject };
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go movetime ${Math.round(moveTimeMs)}`);
      });
    },
    stop() {
      worker.postMessage('stop');
      const p = pending;
      pending = null;
      if (p) {
        staleBestmoves++;
        p.reject(new Error('Engine search stopped'));
      }
    },
    dispose() {
      clearTimeout(timer);
      pending?.reject(new Error('Engine disposed (stopped)'));
      pending = null;
      worker.terminate();
    },
  };
}
