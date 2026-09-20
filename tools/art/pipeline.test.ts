// @vitest-environment node
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from './args';
import { Budget, knownCosts } from './budget';
import { defaultDesign, DesignError, type Design } from './design';
import { Jobs, type StageKey } from './jobs';
import type { MeshyApi } from './meshy/api';
import { MeshyError } from './meshy/client';
import { planStage, runStage, type StageContext } from './pipeline';
import { buildPrompt } from './prompts';
import { ALL_PIECE_KEYS } from './spec';
import { createFakeMeshy, type FakeMeshy } from './testing/fakeMeshy';

interface Setup {
  dir: string;
  design: Design;
  fake: FakeMeshy;
  jobs: Jobs;
  ctx: StageContext;
  lines: string[];
}

function setup(opts: { design?: Design; cap?: number | null; fake?: FakeMeshy; api?: (fake: FakeMeshy) => MeshyApi } = {}): Setup {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
  const design = opts.design ?? defaultDesign();
  const fake = opts.fake ?? createFakeMeshy();
  const jobs = Jobs.load(join(dir, 'jobs.json'));
  const lines: string[] = [];
  const ctx: StageContext = {
    api: opts.api ? opts.api(fake) : fake,
    design,
    jobs,
    dir,
    budget: new Budget({ cap: opts.cap ?? null, known: knownCosts(design) }),
    log: (line) => lines.push(line),
  };
  return { dir, design, fake, jobs, ctx, lines };
}

/** The same project again, as a second command would see it: a fresh budget and the saved jobs. */
const again = (t: Setup, patch: Partial<StageContext> = {}): StageContext => ({
  ...t.ctx,
  budget: new Budget({ cap: null, known: knownCosts(t.design) }),
  ...patch,
});

const succeeded = (jobs: Jobs, piece: string, stage: StageKey, taskId: string) =>
  jobs.add(piece, stage, { taskId, status: 'SUCCEEDED', file: `x/${taskId}`, credits: 1, error: null });

const RIGGED = ALL_PIECE_KEYS.filter((k) => /-(king|queen|bishop|knight)$/.test(k));
const ACTIONS = { idle: 1, attack: 4, hit: 2, die: 3, victory: 5 };

describe('concept stage', () => {
  test('creates one text-to-image task per piece from its prompt, and saves the image', async () => {
    const t = setup();
    const report = await runStage('concept', t.ctx);

    expect(report).toMatchObject({ created: 12, resumed: 0, skipped: 0, blocked: 0, failed: 0, unstarted: 0, stopped: null });
    expect(t.fake.created).toHaveLength(12);
    const king = t.fake.created.find((c) => (c.body.prompt as string) === buildPrompt(t.design, 'w-king'))!;
    expect(king.kind).toBe('text-to-image');
    expect(king.body).toMatchObject({ ai_model: 'nano-banana', pose_mode: 'a-pose' });
    const rook = t.fake.created.find((c) => (c.body.prompt as string) === buildPrompt(t.design, 'w-rook'))!;
    expect(rook.body).not.toHaveProperty('pose_mode');

    for (const key of ALL_PIECE_KEYS) {
      expect(existsSync(join(t.dir, 'concepts', `${key}-1.png`))).toBe(true);
      expect(t.jobs.attempts(key, 'concept')[0]).toMatchObject({ status: 'SUCCEEDED', file: `concepts/${key}-1.png`, credits: 3, error: null });
    }
    expect(report.creditsSpent).toBe(36);
    expect(t.jobs.totalCredits()).toBe(36);
  });

  test('a second run creates nothing', async () => {
    const t = setup();
    await runStage('concept', t.ctx);
    const report = await runStage('concept', again(t));
    expect(report).toMatchObject({ created: 0, skipped: 12 });
    expect(t.fake.created).toHaveLength(12);
  });

  test('--only limits the run, and an unknown piece is a usage error', async () => {
    const t = setup();
    await runStage('concept', { ...t.ctx, only: ['w-king', 'b-pawn'] });
    expect(t.fake.created).toHaveLength(2);
    await expect(runStage('concept', { ...t.ctx, only: ['w-dragon'] })).rejects.toThrow(UsageError);
    await expect(runStage('concept', { ...t.ctx, only: ['w-dragon'] })).rejects.toThrow(/--only: unknown piece "w-dragon"/);
  });

  test('--again adds a new attempt, and the newest becomes the one used', async () => {
    const t = setup();
    await runStage('concept', { ...t.ctx, only: ['w-king'] });
    await runStage('concept', again(t, { only: ['w-king'], again: true }));
    expect(t.jobs.attempts('w-king', 'concept')).toHaveLength(2);
    expect(t.jobs.selectedNumber('w-king', 'concept')).toBe(2);
    expect(existsSync(join(t.dir, 'concepts', 'w-king-2.png'))).toBe(true);
  });

  test('when an earlier attempt was picked on purpose, a re-roll says it is not the one in use', async () => {
    const t = setup();
    await runStage('concept', { ...t.ctx, only: ['w-king'] });
    t.jobs.select('w-king', 'concept', 1);
    await runStage('concept', again(t, { only: ['w-king'], again: true }));
    expect(t.jobs.selectedNumber('w-king', 'concept')).toBe(1);
    expect(t.lines.some((l) => /attempt 2 is not the selected one \(attempt 1\).*pick .*w-king concept 2/.test(l))).toBe(true);
  });

  test('progress lines name the piece and stage', async () => {
    const t = setup();
    await runStage('concept', { ...t.ctx, only: ['w-king'] });
    expect(t.lines.some((l) => l.startsWith('w-king concept:') && l.includes('concepts/w-king-1.png'))).toBe(true);
  });

  test('respects the concurrency limit', async () => {
    const t = setup();
    await runStage('concept', { ...t.ctx, concurrency: 3 });
    expect(t.fake.maxInFlight).toBeLessThanOrEqual(3);
    expect(t.fake.maxInFlight).toBeGreaterThan(1);
  });
});

describe('model stage', () => {
  test('is blocked for a piece with no succeeded concept, and says what to run', async () => {
    const t = setup();
    const report = await runStage('model', { ...t.ctx, only: ['w-king'] });
    expect(report).toMatchObject({ created: 0, blocked: 1 });
    expect(t.lines.join('\n')).toMatch(/w-king model: blocked \(no succeeded concept yet; run --stage concept first\)/);
    expect(t.fake.created).toEqual([]);
  });

  test('chains from the concept task and saves the glb', async () => {
    const t = setup();
    succeeded(t.jobs, 'w-king', 'concept', 'concept-1');
    await runStage('model', { ...t.ctx, only: ['w-king'] });
    expect(t.fake.created[0]).toMatchObject({
      kind: 'image-to-3d',
      body: { input_task_id: 'concept-1', ai_model: 'latest', target_polycount: 15000, pose_mode: 'a-pose', enable_pbr: false },
    });
    expect(t.jobs.attempts('w-king', 'model')[0]).toMatchObject({ status: 'SUCCEEDED', file: 'models/w-king-1.glb', credits: 20 });
    expect(existsSync(join(t.dir, 'models', 'w-king-1.glb'))).toBe(true);
  });

  test('the first task of a kind with an unknown cost runs alone, then the rest run together', async () => {
    const t = setup({ cap: 1000 });
    for (const key of ALL_PIECE_KEYS) succeeded(t.jobs, key, 'concept', `c-${key}`);
    const report = await runStage('model', { ...t.ctx, concurrency: 4 });
    expect(report.created).toBe(12);
    expect(t.fake.inFlightAtCreate.slice(0, 2)).toEqual([0, 0]);
    expect(t.fake.maxInFlight).toBeGreaterThan(1);
    expect(t.ctx.budget.estimate('image-to-3d')).toBe(20);
    expect(report.creditsSpent).toBe(240);
  });

  test('if that first task fails and a cap is set, the run stops instead of spending blind', async () => {
    const t = setup({ cap: 100, fake: createFakeMeshy({ failWith: () => 'no good' }) });
    for (const key of ALL_PIECE_KEYS) succeeded(t.jobs, key, 'concept', `c-${key}`);
    const report = await runStage('model', t.ctx);
    expect(t.fake.created).toHaveLength(1);
    expect(report.failed).toBe(1);
    expect(report.unstarted).toBe(11);
    expect(report.stopped).toMatch(/cost of image-to-3d tasks is still unknown.*credits\.imageTo3d/);
  });

  test('with a design cost set, tasks are budgeted from the start and no task runs alone', async () => {
    const design = defaultDesign();
    design.credits.imageTo3d = 20;
    const t = setup({ design, cap: 1000 });
    for (const key of ALL_PIECE_KEYS) succeeded(t.jobs, key, 'concept', `c-${key}`);
    await runStage('model', { ...t.ctx, concurrency: 4 });
    expect(t.fake.inFlightAtCreate.some((n) => n > 0)).toBe(true);
  });
});

describe('rig stage', () => {
  test('covers the eight rigged pieces, chains from the model task, and skips the rigid ones', async () => {
    const t = setup();
    for (const key of ALL_PIECE_KEYS) succeeded(t.jobs, key, 'model', `m-${key}`);
    const report = await runStage('rig', t.ctx);
    expect(report).toMatchObject({ created: 8, skipped: 4 });
    expect(t.fake.created.map((c) => c.body.input_task_id).sort()).toEqual(RIGGED.map((k) => `m-${k}`).sort());
    expect(t.fake.created[0]!.body).toMatchObject({ height_meters: 1.7 });
    expect(t.lines.join('\n')).toMatch(/w-rook rig: skipped \(rigid piece/);
    expect(existsSync(join(t.dir, 'rigged', 'w-king-1.glb'))).toBe(true);
  });
});

describe('animate stage', () => {
  test('refuses to start until every action id is set, and names the missing clips', async () => {
    const t = setup();
    succeeded(t.jobs, 'w-king', 'rig', 'rig-1');
    await expect(runStage('animate', { ...t.ctx, only: ['w-king'] })).rejects.toThrow(DesignError);
    await expect(runStage('animate', { ...t.ctx, only: ['w-king'] })).rejects.toThrow(
      /design\.json actions: no action id for idle, hit, die, victory.*art actions/,
    );
    expect(t.fake.created).toEqual([]);
  });

  test('creates one animation per clip on the selected rig and saves each glb', async () => {
    const design = defaultDesign();
    design.actions = { ...ACTIONS };
    const t = setup({ design });
    succeeded(t.jobs, 'w-king', 'rig', 'rig-1');
    const report = await runStage('animate', { ...t.ctx, only: ['w-king'] });
    expect(report.created).toBe(5);
    expect(t.fake.created.every((c) => c.kind === 'animations' && c.body.rig_task_id === 'rig-1')).toBe(true);
    expect(t.fake.created.map((c) => c.body.action_id).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const clip of ['idle', 'attack', 'hit', 'die', 'victory']) {
      expect(existsSync(join(t.dir, 'anims', 'w-king', `${clip}-1.glb`))).toBe(true);
    }
    expect(t.jobs.attempts('w-king', 'attack')[0]).toMatchObject({ status: 'SUCCEEDED', credits: 3 });
  });

  test('a rigged piece with no rig is blocked, and a rigid piece is left out entirely', async () => {
    const design = defaultDesign();
    design.actions = { ...ACTIONS };
    const t = setup({ design });
    const report = await runStage('animate', { ...t.ctx, only: ['w-king', 'w-pawn'] });
    expect(report).toMatchObject({ created: 0, blocked: 5 });
    expect(t.lines.join('\n')).toMatch(/w-king idle: blocked \(no succeeded rig yet; run --stage rig first\)/);
    expect(t.lines.join('\n')).not.toMatch(/w-pawn/);
  });
});

describe('resuming and failing', () => {
  test('an unfinished task is picked up again, not created again', async () => {
    const t = setup();
    t.jobs.add('w-king', 'concept', { taskId: 'old-1', status: 'IN_PROGRESS', file: null, credits: null, error: null });
    t.fake.seed('text-to-image', 'old-1', 'IN_PROGRESS');
    const report = await runStage('concept', { ...t.ctx, only: ['w-king'] });
    expect(report).toMatchObject({ created: 0, resumed: 1, failed: 0, creditsSpent: 0 });
    expect(t.fake.created).toEqual([]);
    expect(t.fake.waited).toEqual(['old-1']);
    expect(t.jobs.attempts('w-king', 'concept')[0]).toMatchObject({ status: 'SUCCEEDED', file: 'concepts/w-king-1.png', credits: 3 });
    expect(t.ctx.budget.estimate('text-to-image')).toBe(3);
  });

  test('an unfinished task is resumed even with --again, so a re-roll never doubles up', async () => {
    const t = setup();
    t.jobs.add('w-king', 'concept', { taskId: 'old-1', status: 'PENDING', file: null, credits: null, error: null });
    t.fake.seed('text-to-image', 'old-1', 'PENDING');
    await runStage('concept', { ...t.ctx, only: ['w-king'], again: true });
    expect(t.fake.created).toEqual([]);
  });

  test('one failed task is recorded and does not stop the others; a rerun retries only that one', async () => {
    const fake = createFakeMeshy({ failWith: (_kind, body) => (String(body.prompt).includes('infernal') ? 'content rejected' : null) });
    const t = setup({ fake });
    const report = await runStage('concept', t.ctx);
    expect(report).toMatchObject({ created: 12, failed: 6, stopped: null });
    expect(report.failures).toHaveLength(6);
    expect(report.failures[0]).toMatchObject({ piece: expect.stringMatching(/^b-/), stage: 'concept' });
    expect(report.failures[0]!.message).toMatch(/content rejected/);
    expect(t.jobs.attempts('b-king', 'concept')[0]).toMatchObject({ status: 'FAILED', file: null });
    expect(t.jobs.attempts('b-king', 'concept')[0]!.error).toMatch(/content rejected/);
    expect(t.jobs.attempts('w-king', 'concept')[0]!.status).toBe('SUCCEEDED');

    const second = await runStage('concept', again(t));
    expect(second).toMatchObject({ created: 6, skipped: 6 });
    expect(t.fake.created).toHaveLength(18);
  });

  test('a paid task whose download fails stays unfinished, and the rerun collects it without paying again', async () => {
    let failOnce = true;
    const t = setup({
      api: (fake) => ({
        ...fake,
        download: async (url, dest) => {
          if (failOnce) {
            failOnce = false;
            throw new MeshyError('download failed (403) for assets.example.com/x.png', 403);
          }
          return fake.download(url, dest);
        },
      }),
    });
    const first = await runStage('concept', { ...t.ctx, only: ['w-king'] });
    expect(first).toMatchObject({ created: 1, failed: 1 });
    const attempt = t.jobs.attempts('w-king', 'concept')[0]!;
    expect(attempt.status).not.toBe('FAILED');
    expect(attempt.status).not.toBe('SUCCEEDED');
    expect(attempt.error).toMatch(/download failed/);

    const second = await runStage('concept', again(t, { only: ['w-king'] }));
    expect(second).toMatchObject({ created: 0, resumed: 1, failed: 0 });
    expect(t.fake.created).toHaveLength(1);
    expect(t.jobs.attempts('w-king', 'concept')[0]).toMatchObject({ status: 'SUCCEEDED', file: 'concepts/w-king-1.png' });
  });

  test('a succeeded task whose result cannot be read stays unfinished with the extractor message', async () => {
    const t = setup({
      api: (fake) => ({ ...fake, wait: async (kind, id, opts) => ({ ...(await fake.wait(kind, id, opts)), image_urls: [] }) }),
    });
    const report = await runStage('concept', { ...t.ctx, only: ['w-king'] });
    expect(report.failed).toBe(1);
    const attempt = t.jobs.attempts('w-king', 'concept')[0]!;
    expect(attempt.status).not.toBe('FAILED');
    expect(attempt.error).toMatch(/succeeded but has no image_urls/);
  });

  test('running out of credits mid-run stops the whole run with Meshy message', async () => {
    const t = setup({
      api: (fake) => ({
        ...fake,
        create: async (kind, body) => {
          if (fake.created.length >= 2) throw new MeshyError('Meshy 402: Insufficient funds. The account is out of credits.', 402);
          return fake.create(kind, body);
        },
      }),
    });
    const report = await runStage('concept', { ...t.ctx, concurrency: 1 });
    expect(report).toMatchObject({ created: 2, failed: 1, unstarted: 9 });
    expect(report.stopped).toMatch(/402.*out of credits/);
    expect(t.jobs.attempts('w-king', 'concept')).toHaveLength(1);
  });
});

describe('budget', () => {
  test('stops at the cap: no task past it is created, and the report says why', async () => {
    const t = setup({ cap: 6 });
    const report = await runStage('concept', { ...t.ctx, concurrency: 1 });
    expect(t.fake.created).toHaveLength(2);
    expect(report).toMatchObject({ created: 2, unstarted: 10, creditsSpent: 6 });
    expect(report.stopped).toMatch(/would pass the 6 credit cap/);
  });
});

describe('planStage', () => {
  test('lists what a run would do, with known costs, and creates nothing', async () => {
    const t = setup();
    succeeded(t.jobs, 'w-king', 'concept', 'c1');
    t.jobs.add('b-king', 'concept', { taskId: 'p1', status: 'IN_PROGRESS', file: null, credits: null, error: null });
    const plan = planStage('concept', { ...t.ctx, only: ['w-king', 'b-king', 'w-queen'] });
    expect(plan).toEqual([
      { piece: 'w-king', stage: 'concept', action: 'skip', reason: 'already done (attempt 1)', credits: 0 },
      { piece: 'w-queen', stage: 'concept', action: 'create', credits: 3 },
      { piece: 'b-king', stage: 'concept', action: 'resume', credits: 0 },
    ]);
    expect(t.fake.created).toEqual([]);
    expect(t.fake.waited).toEqual([]);
  });

  test('an unknown cost is null, and a missing prerequisite is blocked with its reason', () => {
    const t = setup();
    succeeded(t.jobs, 'w-king', 'concept', 'c1');
    const plan = planStage('model', { ...t.ctx, only: ['w-king', 'w-queen'] });
    expect(plan[0]).toEqual({ piece: 'w-king', stage: 'model', action: 'create', credits: null });
    expect(plan[1]).toMatchObject({ piece: 'w-queen', action: 'blocked', reason: expect.stringMatching(/no succeeded concept/) });
  });

  test('animate refuses in a plan too, when action ids are missing', () => {
    const t = setup();
    expect(() => planStage('animate', { ...t.ctx, only: ['w-king'] })).toThrow(/no action id for idle, hit, die, victory/);
  });
});
