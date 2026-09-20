// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ALL_PIECE_KEYS } from '../../src/packs/types';
import { main } from './cli';
import { defaultDesign } from './design';
import { Jobs, type StageKey } from './jobs';
import type { MeshyApi } from './meshy/api';
import { MeshyError } from './meshy/client';
import { MissingKeyError } from './meshy/env';
import { CLIP_NAMES } from './spec';
import { createFakeMeshy, type FakeMeshy, type FakeMeshyOptions } from './testing/fakeMeshy';

interface Run {
  code: number;
  out: string;
  err: string;
  apiCalls: number;
  fake: FakeMeshy;
}

/** Runs the CLI in-process against a fake Meshy, capturing what it prints. */
async function run(argv: string[], opts: FakeMeshyOptions & { fake?: FakeMeshy; api?: MeshyApi } = {}): Promise<Run> {
  const fake = opts.fake ?? createFakeMeshy(opts);
  const out: string[] = [];
  const err: string[] = [];
  let apiCalls = 0;
  const log = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  try {
    const code = await main(argv, {
      api: () => {
        apiCalls++;
        return opts.api ?? fake;
      },
    });
    return { code, out: out.join('\n'), err: err.join('\n'), apiCalls, fake };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const tmp = () => mkdtempSync(join(tmpdir(), 'cli-gen-'));

/** A set folder with a design.json, ready for `generate`. */
function project(edit: (d: ReturnType<typeof defaultDesign>) => void = () => {}) {
  const dir = tmp();
  const design = defaultDesign();
  edit(design);
  writeFileSync(join(dir, 'design.json'), JSON.stringify(design));
  return dir;
}

const done = (dir: string, piece: string, stage: StageKey, taskId: string, credits: number | null = 1, file = `f/${taskId}`) =>
  Jobs.load(join(dir, 'jobs.json')).add(piece, stage, { taskId, status: 'SUCCEEDED', file, credits, error: null });

describe('init-set', () => {
  test('creates design.json and points at the next step; a second run refuses', async () => {
    const dir = join(tmp(), 'angels-vs-demons');
    const first = await run(['init-set', dir]);
    expect(first.code).toBe(0);
    expect(first.out).toContain(join(dir, 'design.json'));
    expect(first.out).toMatch(/pnpm art actions/);
    expect(first.apiCalls).toBe(0);
    const second = await run(['init-set', dir]);
    expect(second.code).toBe(1);
    expect(second.err).toMatch(/design\.json already exists/);
  });

  test('needs a folder', async () => {
    const r = await run(['init-set']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/init-set expects <set-dir>/);
  });
});

describe('friendly refusals do not dump the usage text', () => {
  test.each([
    ['no --yes', ['generate', 'DIR', '--stage', 'concept'], /spends credits/],
    ['no --max-credits', ['generate', 'DIR', '--stage', 'concept', '--yes'], /--yes needs --max-credits/],
  ])('%s', async (_name, argv, message) => {
    const r = await run(argv.map((a) => (a === 'DIR' ? project() : a)));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(message);
    expect(r.err).not.toContain('usage:');
  });

  test('a missing API key is one line about the key, not the usage text', async () => {
    const saved = process.env.MESHY_API_KEY;
    delete process.env.MESHY_API_KEY;
    const out: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((...a) => void out.push(a.join(' ')));
    try {
      const code = await main(['balance'], { api: () => { throw new MissingKeyError(); } });
      expect(code).toBe(1);
      expect(out.join('\n')).toMatch(/^MESHY_API_KEY is not set; put MESHY_API_KEY=your_key in \.env/);
      expect(out.join('\n')).not.toContain('usage:');
    } finally {
      error.mockRestore();
      if (saved !== undefined) process.env.MESHY_API_KEY = saved;
    }
  });
});

describe('generate: safety', () => {
  test('refuses to spend without --yes, and never touches Meshy', async () => {
    const dir = project();
    const r = await run(['generate', dir, '--stage', 'concept']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/spends credits.*--dry-run.*--yes --max-credits/);
    expect(r.apiCalls).toBe(0);
    expect(r.fake.created).toEqual([]);
  });

  test('--yes without --max-credits is refused', async () => {
    const r = await run(['generate', project(), '--stage', 'concept', '--yes']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--yes needs --max-credits N/);
    expect(r.apiCalls).toBe(0);
  });

  test('--stage is required and validated', async () => {
    expect((await run(['generate', project(), '--yes', '--max-credits', '5'])).err).toMatch(/--stage must be one of concept, model, rig, animate/);
    expect((await run(['generate', project(), '--stage', 'paint', '--dry-run'])).err).toMatch(/--stage must be one of/);
  });

  test('numbers are validated', async () => {
    const dir = project();
    expect((await run(['generate', dir, '--stage', 'concept', '--yes', '--max-credits', 'lots'])).err).toMatch(/--max-credits expects a number/);
    expect((await run(['generate', dir, '--stage', 'concept', '--dry-run', '--concurrency', '0'])).err).toMatch(/--concurrency expects a whole number from 1 to 10/);
  });

  test('a folder with no design.json points at init-set', async () => {
    const r = await run(['generate', tmp(), '--stage', 'concept', '--dry-run']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/design\.json: not found.*init-set/);
  });
});

describe('generate --dry-run', () => {
  test('prints the plan and a total, needs no key, and writes nothing', async () => {
    const dir = project();
    const r = await run(['generate', dir, '--stage', 'concept', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.apiCalls).toBe(0);
    expect(r.out).toMatch(/w-king\s+concept\s+create\s+~3 credits/);
    expect(r.out).toMatch(/Would create 12 tasks \(about 36 credits\)/);
    expect(r.fake.created).toEqual([]);
    expect(existsSync(join(dir, 'jobs.json'))).toBe(false);
  });

  test('shows blocked pieces with the reason, and an unknown cost as unknown', async () => {
    const dir = project();
    done(dir, 'w-king', 'concept', 'c1');
    const r = await run(['generate', dir, '--stage', 'model', '--only', 'w-king,w-queen', '--dry-run']);
    expect(r.out).toMatch(/w-king\s+model\s+create\s+cost not known yet/);
    expect(r.out).toMatch(/w-queen\s+model\s+blocked\s+no succeeded concept yet/);
    expect(r.out).toMatch(/1 task whose cost is not known yet/);
  });

  test('learns image-to-3d cost from an earlier run recorded in jobs.json', async () => {
    const dir = project();
    done(dir, 'w-king', 'model', 'm1', 22);
    done(dir, 'w-queen', 'concept', 'c2');
    const r = await run(['generate', dir, '--stage', 'model', '--only', 'w-queen', '--dry-run']);
    expect(r.out).toMatch(/w-queen\s+model\s+create\s+~22 credits/);
  });

  test('animate names the action ids that are still unset', async () => {
    const r = await run(['generate', project(), '--stage', 'animate', '--only', 'w-king', '--dry-run']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no action id for idle, hit, die, victory/);
  });
});

describe('generate --yes', () => {
  test('runs a stage, prints the balance and a summary, and records everything', async () => {
    const dir = project();
    const r = await run(['generate', dir, '--stage', 'concept', '--only', 'w-king', '--yes', '--max-credits', '10']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Meshy balance: 1000 credits');
    expect(r.out).toMatch(/concept: created 1, resumed 0, skipped 0, blocked 0, failed 0 - 3 credits spent/);
    expect(r.fake.created).toHaveLength(1);
    expect(existsSync(join(dir, 'concepts', 'w-king-1.png'))).toBe(true);
    expect(Jobs.load(join(dir, 'jobs.json')).attempts('w-king', 'concept')).toHaveLength(1);
  });

  test('refuses a run the balance cannot cover, before creating anything', async () => {
    const r = await run(['generate', project(), '--stage', 'concept', '--yes', '--max-credits', '100'], { balance: 2 });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/needs about 36 credits but the balance is 2/);
    expect(r.fake.created).toEqual([]);
  });

  test('a failed task makes the exit code 1 and is listed in the summary', async () => {
    const r = await run(['generate', project(), '--stage', 'concept', '--only', 'w-king', '--yes', '--max-credits', '10'], {
      failWith: () => 'content rejected',
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/failed 1/);
    expect(r.out).toMatch(/w-king concept: .*content rejected/);
  });

  test('stopping at the cap is reported and exits 1', async () => {
    const r = await run(['generate', project(), '--stage', 'concept', '--yes', '--max-credits', '6', '--concurrency', '1']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/stopped: .*would pass the 6 credit cap/);
    expect(r.fake.created).toHaveLength(2);
  });

  test('a Meshy error is printed as one message, not a stack trace', async () => {
    const api: MeshyApi = { ...createFakeMeshy(), balance: async () => { throw new MeshyError('Meshy 401: Unauthorized. Check MESHY_API_KEY in .env.', 401); } };
    const r = await run(['generate', project(), '--stage', 'concept', '--yes', '--max-credits', '10'], { api });
    expect(r.code).toBe(1);
    expect(r.err).toBe('Meshy 401: Unauthorized. Check MESHY_API_KEY in .env.');
  });
});

describe('pick', () => {
  test('chooses an attempt for later stages', async () => {
    const dir = project();
    done(dir, 'w-king', 'concept', 'a');
    done(dir, 'w-king', 'concept', 'b');
    const r = await run(['pick', dir, 'w-king', 'concept', '1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/w-king concept: attempt 1 is now the one used/);
    expect(Jobs.load(join(dir, 'jobs.json')).selected('w-king', 'concept')?.taskId).toBe('a');
  });

  test('a clip name is a valid stage', async () => {
    const dir = project();
    done(dir, 'w-king', 'attack', 'x');
    expect((await run(['pick', dir, 'w-king', 'attack', '1'])).code).toBe(0);
  });

  test('bad arguments are explained', async () => {
    const dir = project();
    done(dir, 'w-king', 'concept', 'a');
    expect((await run(['pick', dir, 'w-king', 'concept', '5'])).err).toMatch(/choose 1 to 1/);
    expect((await run(['pick', dir, 'w-king', 'paint', '1'])).err).toMatch(/stage must be one of concept, model, rig, idle, attack, hit, die, victory/);
    expect((await run(['pick', dir, 'w-dragon', 'concept', '1'])).err).toMatch(/unknown piece "w-dragon"/);
    expect((await run(['pick', dir, 'w-king', 'concept'])).err).toMatch(/pick expects <set-dir> <piece> <stage> <n>/);
    expect((await run(['pick', dir, 'w-king', 'concept', 'one'])).err).toMatch(/<n> must be a whole number/);
  });
});

describe('balance and actions', () => {
  test('balance prints the credits', async () => {
    const r = await run(['balance'], { balance: 250 });
    expect(r.code).toBe(0);
    expect(r.out).toBe('Meshy balance: 250 credits');
  });

  test('actions lists library entries with ids, filtered by --search', async () => {
    const library = [
      { action_id: 4, name: 'Attack', category: 'Fighting', sub_category: 'AttackingwithWeapon' },
      { action_id: 11, name: 'Idle Breathing', category: 'DailyActions' },
    ];
    const all = await run(['actions'], { library });
    expect(all.out).toMatch(/2 animations/);
    expect(all.out).toMatch(/^\s*4  Attack  \(Fighting \/ AttackingwithWeapon\)$/m);
    const found = await run(['actions', '--search', 'idle'], { library });
    expect(found.out).toMatch(/1 animation matching "idle"/);
    expect(found.out).toMatch(/11  Idle Breathing  \(DailyActions\)/);
    expect(found.out).not.toMatch(/Attack/);
  });

  test('actions with no matches says so', async () => {
    const r = await run(['actions', '--search', 'zzz'], { library: [{ action_id: 1, name: 'Idle' }] });
    expect(r.out).toBe('no animations match "zzz"');
  });
});

describe('assemble', () => {
  function completeProject(): string {
    const dir = project((d) => (d.actions = { idle: 1, attack: 4, hit: 2, die: 3, victory: 5 }));
    const jobs = Jobs.load(join(dir, 'jobs.json'));
    const put = (rel: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), 'x');
      return rel;
    };
    for (const key of ALL_PIECE_KEYS) {
      const rigged = /-(king|queen|bishop|knight)$/.test(key);
      const add = (stage: StageKey, file: string) => jobs.add(key, stage, { taskId: `${key}-${stage}`, status: 'SUCCEEDED', file: put(file), credits: 1, error: null });
      if (rigged) {
        add('rig', `rigged/${key}-1.glb`);
        for (const clip of CLIP_NAMES) add(clip, `anims/${key}/${clip}-1.glb`);
      } else add('model', `models/${key}-1.glb`);
    }
    return dir;
  }

  test('writes set.json and says what to run next', async () => {
    const dir = completeProject();
    const r = await run(['assemble', dir]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/wrote .*set\.json for 12 pieces/);
    expect(r.out).toMatch(/pnpm art build-set .* public\/packs\/sets\/angels-vs-demons/);
    expect(JSON.parse(readFileSync(join(dir, 'set.json'), 'utf8')).id).toBe('angels-vs-demons');
  });

  test('an incomplete project lists what is missing and exits 1', async () => {
    const r = await run(['assemble', project()]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/cannot assemble: \d+ problems/);
    expect(r.err).toMatch(/w-king rig: no rig yet/);
    expect(r.apiCalls).toBe(0);
  });
});

describe('usage', () => {
  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('the word "%s" is an unknown command, not an inherited method', async (word) => {
    const r = await run([word]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('usage:');
    expect(r.apiCalls).toBe(0);
  });

  test('the usage text lists the new commands', async () => {
    const r = await run(['frobnicate']);
    expect(r.code).toBe(1);
    for (const word of ['init-set', 'balance', 'actions', 'generate', 'pick', 'assemble']) expect(r.err).toContain(word);
  });
});
