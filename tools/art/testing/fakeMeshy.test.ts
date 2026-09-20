// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MeshyApi } from '../meshy/api';
import { MeshyError, MeshyTaskError } from '../meshy/client';
import { resultUrl } from '../meshy/endpoints';
import { createFakeMeshy } from './fakeMeshy';

describe('fake Meshy', () => {
  test('implements MeshyApi, and each kind returns a result the real extractor can read', async () => {
    const fake = createFakeMeshy();
    const api: MeshyApi = fake;
    for (const [kind, ext] of [['text-to-image', 'png'], ['image-to-3d', 'glb'], ['rigging', 'glb'], ['animations', 'glb']] as const) {
      const id = await api.create(kind, { any: 'body' });
      const task = await api.wait(kind, id);
      expect(task.status).toBe('SUCCEEDED');
      expect(resultUrl(kind, task)).toBe(`https://fake.assets/${id}.${ext}`);
    }
    expect(fake.created.map((c) => c.kind)).toEqual(['text-to-image', 'image-to-3d', 'rigging', 'animations']);
  });

  test('reports consumed credits per kind and draws the balance down as tasks finish', async () => {
    const fake = createFakeMeshy({ balance: 100, costs: { rigging: 7 } });
    const id = await fake.create('rigging', {});
    expect((await fake.wait('rigging', id)).consumed_credits).toBe(7);
    expect(await fake.balance()).toBe(93);
  });

  test('failWith makes a task fail with that message and consume nothing', async () => {
    const fake = createFakeMeshy({ balance: 50, failWith: (kind) => (kind === 'rigging' ? 'model has no limbs' : null) });
    const id = await fake.create('rigging', {});
    const error = await fake.wait('rigging', id).catch((e) => e);
    expect(error).toBeInstanceOf(MeshyTaskError);
    expect(error.message).toMatch(/rigging task .* failed: model has no limbs/);
    expect(await fake.balance()).toBe(50);
  });

  test('a seeded task behaves like one a previous run created', async () => {
    const fake = createFakeMeshy();
    fake.seed('image-to-3d', 'old-1', 'IN_PROGRESS');
    const task = await fake.wait('image-to-3d', 'old-1');
    expect(task.status).toBe('SUCCEEDED');
    expect(fake.created).toEqual([]);
    expect(fake.waited).toEqual(['old-1']);
  });

  test('waiting on an unknown task is a 404', async () => {
    const error = await createFakeMeshy().wait('rigging', 'nope').catch((e) => e);
    expect(error).toBeInstanceOf(MeshyError);
    expect(error.status).toBe(404);
  });

  test('maxInFlight sees overlapping tasks', async () => {
    const fake = createFakeMeshy();
    const ids = await Promise.all([fake.create('rigging', {}), fake.create('rigging', {}), fake.create('rigging', {})]);
    await Promise.all(ids.map((id) => fake.wait('rigging', id)));
    expect(fake.maxInFlight).toBe(3);
  });

  test('download writes a file at the destination and records it', async () => {
    const fake = createFakeMeshy();
    const dest = join(mkdtempSync(join(tmpdir(), 'fake-dl-')), 'x', 'y.png');
    await fake.download('https://fake.assets/t-1.png', dest);
    expect(readFileSync(dest, 'utf8')).toContain('t-1.png');
    expect(fake.downloads).toEqual([{ url: 'https://fake.assets/t-1.png', dest }]);
  });

  test('library filters by name', async () => {
    const fake = createFakeMeshy({ library: [{ action_id: 1, name: 'Idle' }, { action_id: 4, name: 'Attack' }] });
    expect(await fake.library('att')).toEqual([{ action_id: 4, name: 'Attack' }]);
    expect(await fake.library()).toHaveLength(2);
  });
});
