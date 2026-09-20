import type { EngineWorker, WorkerFactory } from './engine';

/**
 * Served from public/stockfish/, populated by scripts/copy-stockfish.mjs on install
 * (the single-threaded lite build of stockfish 19; needs no cross-origin isolation).
 * If that script logs a different file name for your installed stockfish version,
 * update this constant to match.
 */
export const STOCKFISH_URL = '/stockfish/stockfish-19-lite-single.js';

export const stockfishWorkerFactory: WorkerFactory = () => {
  const w = new Worker(STOCKFISH_URL);
  return w as unknown as EngineWorker;
};
