import { existsSync } from 'node:fs';
import type { MeshyApi } from './api';
import { MeshyClient } from './client';

/** The key is not set. Not a usage mistake, so it prints without the usage text. */
export class MissingKeyError extends Error {
  constructor() {
    super('MESHY_API_KEY is not set; put MESHY_API_KEY=your_key in .env (see .env.example)');
    this.name = 'MissingKeyError';
  }
}

/**
 * A Meshy client using `MESHY_API_KEY` from the environment, loading `.env` first if there is one.
 * A variable already set in the environment wins over the file. The key is never put in a message.
 */
export function apiFromEnvironment(envFile = '.env'): MeshyApi {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const apiKey = process.env.MESHY_API_KEY?.trim();
  if (!apiKey) throw new MissingKeyError();
  return new MeshyClient({ apiKey });
}
