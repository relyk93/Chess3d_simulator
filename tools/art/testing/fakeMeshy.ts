import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LibraryAction, MeshyApi, MeshyTask, TaskKind, TaskStatus, WaitOptions } from '../meshy/api';
import { MeshyError, MeshyTaskError } from '../meshy/client';

export interface FakeMeshyOptions {
  balance?: number;
  /** Credits each kind reports as consumed. Defaults: text-to-image 3, image-to-3d 20, rigging 5, animations 3. */
  costs?: Partial<Record<TaskKind, number>>;
  /** Return a message to make a task fail, or null to let it succeed. Called when the task is created. */
  failWith?: (kind: TaskKind, body: Record<string, unknown>) => string | null;
  library?: LibraryAction[];
}

export interface FakeMeshy extends MeshyApi {
  created: { kind: TaskKind; body: Record<string, unknown>; id: string }[];
  /** Task ids passed to `wait`, in order. */
  waited: string[];
  downloads: { url: string; dest: string }[];
  /** The most tasks that were in flight (created or resumed, not yet finished) at the same moment. */
  maxInFlight: number;
  /** How many tasks were in flight when each create call arrived, for "runs alone" assertions. */
  inFlightAtCreate: number[];
  /** Registers a task that already exists on Meshy's side, as a previous run would have created. */
  seed(kind: TaskKind, id: string, status: TaskStatus): void;
}

const DEFAULT_COSTS: Record<TaskKind, number> = { 'text-to-image': 3, 'image-to-3d': 20, rigging: 5, animations: 3 };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function resultFields(kind: TaskKind, id: string): Record<string, unknown> {
  const url = (ext: string) => `https://fake.assets/${id}.${ext}`;
  switch (kind) {
    case 'text-to-image':
      return { image_urls: [url('png')] };
    case 'image-to-3d':
      return { model_urls: { glb: url('glb') } };
    case 'rigging':
      return { result: { rigged_character_glb_url: url('glb') } };
    case 'animations':
      return { result: { animation_glb_url: url('glb') } };
  }
}

/** An in-memory Meshy for pipeline tests: it completes every task on the next tick, with realistic shapes. */
export function createFakeMeshy(opts: FakeMeshyOptions = {}): FakeMeshy {
  const costs = { ...DEFAULT_COSTS, ...opts.costs };
  const tasks = new Map<string, { kind: TaskKind; failure: string | null }>();
  const active = new Set<string>();
  let remaining = opts.balance ?? 1000;
  let next = 1;

  const fake: FakeMeshy = {
    created: [],
    waited: [],
    downloads: [],
    maxInFlight: 0,
    inFlightAtCreate: [],

    async balance() {
      return remaining;
    },

    async create(kind, body) {
      fake.inFlightAtCreate.push(active.size);
      const id = `task-${next++}`;
      const failure = opts.failWith?.(kind, body as Record<string, unknown>) ?? null;
      tasks.set(id, { kind, failure });
      active.add(id);
      fake.maxInFlight = Math.max(fake.maxInFlight, active.size);
      fake.created.push({ kind, body: body as Record<string, unknown>, id });
      return id;
    },

    async wait(kind: TaskKind, id: string, waitOpts: WaitOptions = {}): Promise<MeshyTask> {
      fake.waited.push(id);
      const task = tasks.get(id);
      if (!task) throw new MeshyError(`Meshy 404: task ${id} not found.`, 404);
      active.add(id);
      fake.maxInFlight = Math.max(fake.maxInFlight, active.size);
      waitOpts.onProgress?.(50);
      await tick();
      active.delete(id);
      if (task.failure) throw new MeshyTaskError(`${kind} task ${id} failed: ${task.failure}`, id);
      waitOpts.onProgress?.(100);
      const credits = costs[kind];
      remaining -= credits;
      return { id, status: 'SUCCEEDED', progress: 100, consumed_credits: credits, ...resultFields(kind, id) };
    },

    async download(url, dest) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, `fake asset for ${url}`);
      fake.downloads.push({ url, dest });
    },

    async library(search) {
      const all = opts.library ?? [];
      return search ? all.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())) : all;
    },

    seed(kind, id, status) {
      tasks.set(id, { kind, failure: status === 'FAILED' || status === 'CANCELED' ? `seeded as ${status.toLowerCase()}` : null });
    },
  };
  return fake;
}
