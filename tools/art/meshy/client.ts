import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TASK_PATH, type LibraryAction, type MeshyApi, type MeshyTask, type TaskKind, type WaitOptions } from './api';

export class MeshyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MeshyError';
  }
}

export class MeshyTaskError extends Error {
  constructor(message: string, readonly taskId: string) {
    super(message);
    this.name = 'MeshyTaskError';
  }
}

export interface MeshyClientOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  /** Delay between polls of a running task. Default 5 s. */
  pollMs?: number;
  /** How long `wait` polls before giving up. Default 15 minutes. */
  timeoutMs?: number;
  /** Retries for 429, 5xx and network failures. Default 5. */
  maxRetries?: number;
  /** First retry delay, doubled each time. Default 1 s. */
  retryBaseMs?: number;
}

const HINTS: Record<number, string> = {
  401: 'Check MESHY_API_KEY in .env.',
  402: 'The account is out of credits.',
  429: 'Meshy is rate limiting or its task queue is full.',
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MeshyClient implements MeshyApi {
  private readonly key: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: MeshyClientOptions) {
    this.key = opts.apiKey;
    this.doFetch = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.baseUrl = opts.baseUrl ?? 'https://api.meshy.ai';
    this.pollMs = opts.pollMs ?? 5000;
    this.timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    this.maxRetries = opts.maxRetries ?? 5;
    this.retryBaseMs = opts.retryBaseMs ?? 1000;
  }

  /** Every message that leaves this class goes through here, in case a server echoes the key. */
  private redact(text: string): string {
    return this.key.length >= 8 ? text.split(this.key).join('***') : text;
  }

  private fail(message: string, status: number): MeshyError {
    return new MeshyError(this.redact(message), status);
  }

  /** Sends a request, retrying 429, 5xx and network failures with doubling delays. Returns the final response. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(url, init);
      } catch (e) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }
        const reason = e instanceof Error ? e.message : String(e);
        throw this.fail(`network error: ${reason} (gave up after ${this.maxRetries} retries)`, 0);
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) return res;
      await this.sleep(this.retryBaseMs * 2 ** attempt);
    }
  }

  private async describe(res: Response): Promise<MeshyError> {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string') message = parsed.message;
    } catch {
      /* not JSON; keep the raw text */
    }
    const retried = res.status === 429 || res.status >= 500 ? ` (gave up after ${this.maxRetries} retries)` : '';
    const hint = HINTS[res.status] ? ` ${HINTS[res.status]}` : '';
    return this.fail(`Meshy ${res.status}: ${message || res.statusText}.${hint}${retried}`, res.status);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const res = await this.send(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await this.describe(res);
    return (await res.json()) as T;
  }

  async balance(): Promise<number> {
    const { balance } = await this.request<{ balance?: unknown }>('GET', '/openapi/v1/balance');
    if (typeof balance !== 'number') throw this.fail('unexpected balance response: no numeric "balance" field', 200);
    return balance;
  }

  async create(kind: TaskKind, body: object): Promise<string> {
    const { result } = await this.request<{ result?: unknown }>('POST', TASK_PATH[kind], body);
    if (typeof result !== 'string' || result === '') {
      throw this.fail(`unexpected create response for ${kind}: no task id in "result"`, 200);
    }
    return result;
  }

  async wait(kind: TaskKind, id: string, opts: WaitOptions = {}): Promise<MeshyTask> {
    let waited = 0;
    let lastProgress: number | undefined;
    for (;;) {
      const task = await this.request<MeshyTask>('GET', `${TASK_PATH[kind]}/${id}`);
      if (typeof task.progress === 'number' && task.progress !== lastProgress) {
        lastProgress = task.progress;
        opts.onProgress?.(task.progress);
      }
      if (task.status === 'SUCCEEDED') return task;
      if (task.status === 'FAILED' || task.status === 'CANCELED') {
        const reason = task.task_error?.message || 'no reason given';
        throw new MeshyTaskError(this.redact(`${kind} task ${id} ${task.status.toLowerCase()}: ${reason}`), id);
      }
      if (waited >= this.timeoutMs) {
        throw new MeshyTaskError(`${kind} task ${id} still ${task.status} after ${this.timeoutMs / 1000}s`, id);
      }
      await this.sleep(this.pollMs);
      waited += this.pollMs;
    }
  }

  async download(url: string, destPath: string): Promise<void> {
    // Asset URLs are pre-signed and hosted elsewhere, so no Authorization header goes with them.
    const res = await this.send(url, { method: 'GET' });
    if (!res.ok) {
      const at = new URL(url);
      throw this.fail(`download failed (${res.status}) for ${at.host}${at.pathname}`, res.status);
    }
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, new Uint8Array(await res.arrayBuffer()));
  }

  async library(search?: string): Promise<LibraryAction[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const json = await this.request<unknown>('GET', `/openapi/v1/animations/library${query}`);
    const list = Array.isArray(json) ? json : (json as { result?: unknown } | null)?.result;
    if (!Array.isArray(list)) throw this.fail('unexpected animation library response: expected a list', 200);
    return list as LibraryAction[];
  }
}
