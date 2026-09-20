// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshyClient, MeshyError, MeshyTaskError } from './client';

const KEY = 'msy_SECRET_KEY_123';

type Call = { url: string; init: RequestInit };
type Reply = { status?: number; body?: unknown; bytes?: Uint8Array } | Error;

/** A fetch that answers from a queue of replies, one per call, and records every call. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const reply = replies.shift();
    if (!reply) throw new Error('fakeFetch: no reply queued');
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    const body = reply.bytes ?? JSON.stringify(reply.body ?? {});
    return new Response(body as BodyInit, { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function client(replies: Reply[], extra: Partial<ConstructorParameters<typeof MeshyClient>[0]> = {}) {
  const { fetch, calls } = fakeFetch(replies);
  const sleeps: number[] = [];
  const api = new MeshyClient({
    apiKey: KEY,
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    pollMs: 1000,
    timeoutMs: 5000,
    retryBaseMs: 500,
    maxRetries: 3,
    ...extra,
  });
  return { api, calls, sleeps };
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe('requests', () => {
  test('create posts JSON with the bearer header and returns the task id', async () => {
    const { api, calls } = client([{ body: { result: 'task-1' } }]);
    await expect(api.create('image-to-3d', { input_task_id: 'abc' })).resolves.toBe('task-1');
    expect(calls[0]!.url).toBe('https://api.meshy.ai/openapi/v1/image-to-3d');
    expect(calls[0]!.init.method).toBe('POST');
    expect(header(calls[0]!, 'authorization')).toBe(`Bearer ${KEY}`);
    expect(header(calls[0]!, 'content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ input_task_id: 'abc' });
  });

  test('each task kind posts to its own endpoint', async () => {
    const { api, calls } = client([
      { body: { result: 'a' } }, { body: { result: 'b' } }, { body: { result: 'c' } }, { body: { result: 'd' } },
    ]);
    for (const kind of ['text-to-image', 'image-to-3d', 'rigging', 'animations'] as const) await api.create(kind, {});
    expect(calls.map((c) => c.url.replace('https://api.meshy.ai', ''))).toEqual([
      '/openapi/v1/text-to-image', '/openapi/v1/image-to-3d', '/openapi/v1/rigging', '/openapi/v1/animations',
    ]);
  });

  test('a create response without a task id is an error', async () => {
    const { api } = client([{ body: { nope: true } }]);
    await expect(api.create('rigging', {})).rejects.toThrow(/unexpected create response/);
  });

  test('balance returns the number', async () => {
    const { api, calls } = client([{ body: { balance: 250 } }]);
    await expect(api.balance()).resolves.toBe(250);
    expect(calls[0]!.url).toBe('https://api.meshy.ai/openapi/v1/balance');
    expect(calls[0]!.init.method).toBe('GET');
  });

  test('library searches with an encoded query and accepts a bare array', async () => {
    const actions = [{ action_id: 4, name: 'Attack', category: 'Fighting' }];
    const { api, calls } = client([{ body: actions }]);
    await expect(api.library('double attack')).resolves.toEqual(actions);
    expect(calls[0]!.url).toBe('https://api.meshy.ai/openapi/v1/animations/library?search=double%20attack');
  });

  test('library also accepts the list wrapped in a result field', async () => {
    const actions = [{ action_id: 1, name: 'Idle' }];
    const { api } = client([{ body: { result: actions } }]);
    await expect(api.library()).resolves.toEqual(actions);
  });
});

describe('errors and retries', () => {
  test('401 names the key setting and carries the status', async () => {
    const { api } = client([{ status: 401, body: { message: 'Unauthorized' } }]);
    const error = await api.balance().catch((e) => e);
    expect(error).toBeInstanceOf(MeshyError);
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/401.*Unauthorized.*MESHY_API_KEY/);
  });

  test('402 says the account is out of credits', async () => {
    const { api } = client([{ status: 402, body: { message: 'Insufficient funds' } }]);
    await expect(api.create('rigging', {})).rejects.toThrow(/402.*Insufficient funds.*out of credits/);
  });

  test('a 4xx is not retried', async () => {
    const { api, calls } = client([{ status: 400, body: { message: 'bad param' } }]);
    await expect(api.create('rigging', {})).rejects.toThrow(/400.*bad param/);
    expect(calls).toHaveLength(1);
  });

  test('429 is retried with growing delays, then succeeds', async () => {
    const { api, calls, sleeps } = client([
      { status: 429, body: { message: 'RateLimitExceeded' } },
      { status: 429, body: { message: 'NoMoreConcurrentTasks' } },
      { body: { result: 'ok' } },
    ]);
    await expect(api.create('rigging', {})).resolves.toBe('ok');
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  test('429 gives up after the retry limit and says so', async () => {
    const replies: Reply[] = Array.from({ length: 4 }, () => ({ status: 429, body: { message: 'RateLimitExceeded' } }));
    const { api, calls } = client(replies);
    const error = await api.create('rigging', {}).catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/after 3 retries/);
    expect(calls).toHaveLength(4);
  });

  test('a 5xx is retried', async () => {
    const { api, calls } = client([{ status: 503, body: {} }, { body: { balance: 1 } }]);
    await expect(api.balance()).resolves.toBe(1);
    expect(calls).toHaveLength(2);
  });

  test('a network failure is retried, then reported as one', async () => {
    const { api, calls } = client([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
    const error = await api.balance().catch((e) => e);
    expect(error).toBeInstanceOf(MeshyError);
    expect(error.message).toMatch(/network error.*fetch failed/);
    expect(calls).toHaveLength(4);
  });

  test('the key never appears in an error, even if the server echoes it', async () => {
    const { api } = client([{ status: 400, body: { message: `bad token ${KEY}` } }]);
    const error = await api.balance().catch((e) => e);
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('***');
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(KEY);
  });
});

describe('wait', () => {
  test('polls until the task succeeds and reports progress', async () => {
    const { api, calls, sleeps } = client([
      { body: { id: 't', status: 'PENDING' } },
      { body: { id: 't', status: 'IN_PROGRESS', progress: 40 } },
      { body: { id: 't', status: 'SUCCEEDED', progress: 100, consumed_credits: 5 } },
    ]);
    const seen: number[] = [];
    const task = await api.wait('rigging', 't', { onProgress: (p) => seen.push(p) });
    expect(task.status).toBe('SUCCEEDED');
    expect(task.consumed_credits).toBe(5);
    expect(seen).toEqual([40, 100]);
    expect(sleeps).toEqual([1000, 1000]);
    expect(calls.map((c) => c.url)).toEqual(Array(3).fill('https://api.meshy.ai/openapi/v1/rigging/t'));
  });

  test.each(['FAILED', 'CANCELED'])('a %s task throws with the task message and id', async (status) => {
    const { api } = client([{ body: { id: 't9', status, task_error: { message: 'model has no limbs' } } }]);
    const error = await api.wait('rigging', 't9').catch((e) => e);
    expect(error).toBeInstanceOf(MeshyTaskError);
    expect(error.taskId).toBe('t9');
    expect(error.message).toMatch(new RegExp(`rigging task t9 ${status.toLowerCase()}: model has no limbs`));
  });

  test('a failed task with no message still says something', async () => {
    const { api } = client([{ body: { id: 't', status: 'FAILED' } }]);
    await expect(api.wait('image-to-3d', 't')).rejects.toThrow(/no reason given/);
  });

  test('gives up after the timeout and names the last status', async () => {
    const replies: Reply[] = Array.from({ length: 10 }, () => ({ body: { id: 't', status: 'IN_PROGRESS', progress: 10 } }));
    const { api } = client(replies);
    await expect(api.wait('animations', 't')).rejects.toThrow(/animations task t still IN_PROGRESS after 5s/);
  });
});

describe('download', () => {
  test('writes the bytes into a new nested folder without sending the API key', async () => {
    const { api, calls } = client([{ bytes: new Uint8Array([1, 2, 3, 4]) }]);
    const dest = join(mkdtempSync(join(tmpdir(), 'meshy-dl-')), 'a', 'b', 'file.glb');
    await api.download('https://assets.example.com/x/file.glb?Signature=abc', dest);
    expect(Array.from(readFileSync(dest))).toEqual([1, 2, 3, 4]);
    expect(header(calls[0]!, 'authorization')).toBeNull();
  });

  test('a failed download reports the status and host, not the signed query string', async () => {
    const { api } = client([{ status: 403, body: {} }]);
    const dest = join(mkdtempSync(join(tmpdir(), 'meshy-dl-')), 'file.glb');
    const error = await api.download('https://assets.example.com/x/file.glb?Signature=SECRET', dest).catch((e) => e);
    expect(error.message).toMatch(/download failed \(403\).*assets\.example\.com\/x\/file\.glb/);
    expect(error.message).not.toContain('SECRET');
    expect(existsSync(dest)).toBe(false);
  });

  test('a download is retried on a 5xx', async () => {
    const { api, calls } = client([{ status: 502, body: {} }, { bytes: new Uint8Array([9]) }]);
    const dest = join(mkdtempSync(join(tmpdir(), 'meshy-dl-')), 'f.glb');
    await api.download('https://assets.example.com/f.glb', dest);
    expect(calls).toHaveLength(2);
  });
});
