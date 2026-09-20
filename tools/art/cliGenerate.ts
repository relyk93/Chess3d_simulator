import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from './args';
import { assemble } from './assemble';
import { Budget, knownCosts } from './budget';
import { loadDesign } from './design';
import { initSet } from './init';
import { Jobs, type StageKey } from './jobs';
import type { MeshyApi, TaskKind } from './meshy/api';
import { planStage, runStage, type PlanItem, type Stage, type StageReport } from './pipeline';
import { ALL_PIECE_KEYS, CLIP_NAMES } from './spec';

export interface CliDeps {
  /** Makes the Meshy client. Called only by commands that need it, so the others work without a key. */
  api: () => MeshyApi;
}

/** A command that would do something the caller did not ask for, so it stopped. Not a usage mistake. */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

const STAGES = ['concept', 'model', 'rig', 'animate'] as const;
const PICKABLE: readonly StageKey[] = ['concept', 'model', 'rig', ...CLIP_NAMES];

/** Task kind that each recorded stage's cost belongs to, for teaching the budget what earlier runs cost. */
const KIND_OF_STAGE: [StageKey, TaskKind][] = [
  ['concept', 'text-to-image'],
  ['model', 'image-to-3d'],
  ['rig', 'rigging'],
  ...CLIP_NAMES.map((clip): [StageKey, TaskKind] => [clip, 'animations']),
];

function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatPlan(items: PlanItem[]): string[] {
  return items.map((item) => {
    const detail =
      item.action === 'create' ? (item.credits === null ? 'cost not known yet' : `~${item.credits} credits`) : (item.reason ?? '');
    return `  ${item.piece.padEnd(10)}${item.stage.padEnd(9)}${item.action.padEnd(9)}${detail}`.trimEnd();
  });
}

export function formatPlanTotals(items: PlanItem[]): string[] {
  const creates = items.filter((i) => i.action === 'create');
  const known = creates.reduce((sum, i) => sum + (i.credits ?? 0), 0);
  const unknown = creates.filter((i) => i.credits === null).length;
  const count = (action: PlanItem['action']) => items.filter((i) => i.action === action).length;
  const parts: string[] = [];
  if (known > 0 || unknown === 0) parts.push(`about ${known} credits`);
  if (unknown > 0) parts.push(`${plural(unknown, 'task')} whose cost is not known yet`);
  return [
    creates.length === 0 ? 'Nothing to create.' : `Would create ${plural(creates.length, 'task')} (${parts.join(', plus ')}).`,
    `${count('resume')} to resume, ${count('skip')} already done or not needed, ${count('blocked')} blocked.`,
  ];
}

export function formatSummary(stage: Stage, r: StageReport): string[] {
  const lines = [
    `${stage}: created ${r.created}, resumed ${r.resumed}, skipped ${r.skipped}, blocked ${r.blocked}, failed ${r.failed} - ${r.creditsSpent} credits spent`,
  ];
  if (r.unstarted > 0) lines.push(`not started: ${r.unstarted}`);
  if (r.stopped) lines.push(`stopped: ${r.stopped}`);
  if (r.failures.length > 0) {
    lines.push('failures:');
    for (const f of r.failures) lines.push(`  ${f.piece} ${f.stage}: ${f.message}`);
  }
  return lines;
}

function initSetCommand(argv: string[]): number {
  const { positionals } = parsed(() => parseArgs({ args: argv, allowPositionals: true, strict: true, options: {} }));
  const [dir] = positionals;
  if (!dir) throw new UsageError('init-set expects <set-dir>');
  const { designPath, copied } = initSet(dir);
  console.log(`created ${designPath}`);
  if (copied.length > 0) console.log(`copied ${plural(copied.length, 'placeholder sound')} from the dev pack: ${copied.join(', ')}`);
  console.log(`next: edit the style and prompts, then look up action ids with: pnpm art actions --search idle`);
  return 0;
}

async function balanceCommand(deps: CliDeps): Promise<number> {
  console.log(`Meshy balance: ${await deps.api().balance()} credits`);
  return 0;
}

async function actionsCommand(argv: string[], deps: CliDeps): Promise<number> {
  const { values } = parsed(() => parseArgs({ args: argv, strict: true, options: { search: { type: 'string' } } }));
  const list = await deps.api().library(values.search);
  if (list.length === 0) {
    console.log(values.search ? `no animations match "${values.search}"` : 'the animation library is empty');
    return 0;
  }
  console.log(values.search ? `${plural(list.length, 'animation')} matching "${values.search}":` : `${plural(list.length, 'animation')}:`);
  for (const a of list) {
    const where = [a.category, a.sub_category].filter(Boolean).join(' / ');
    console.log(`  ${String(a.action_id).padStart(5)}  ${a.name}${where ? `  (${where})` : ''}`);
  }
  console.log('set the ids you want in design.json under "actions".');
  return 0;
}

async function generateCommand(argv: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parsed(() =>
    parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        stage: { type: 'string' },
        only: { type: 'string' },
        again: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        'max-credits': { type: 'string' },
        concurrency: { type: 'string' },
      },
    }),
  );
  const [dir] = positionals;
  if (!dir) throw new UsageError('generate expects <set-dir>');
  const stage = STAGES.find((s) => s === values.stage);
  if (!stage) throw new UsageError(`--stage must be one of ${STAGES.join(', ')}`);

  const dryRun = values['dry-run'] === true;
  if (!dryRun && values.yes !== true) {
    throw new RefusedError('generate spends credits. Preview with --dry-run, then run with --yes --max-credits N.');
  }
  let cap: number | undefined;
  if (values['max-credits'] !== undefined) {
    cap = Number(values['max-credits']);
    if (!Number.isFinite(cap) || cap <= 0) throw new UsageError(`--max-credits expects a number above 0, got "${values['max-credits']}"`);
  }
  if (!dryRun && cap === undefined) throw new RefusedError('--yes needs --max-credits N so a run cannot spend without a limit');
  let concurrency: number | undefined;
  if (values.concurrency !== undefined) {
    concurrency = Number(values.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
      throw new UsageError(`--concurrency expects a whole number from 1 to 10, got "${values.concurrency}"`);
    }
  }

  const design = loadDesign(dir);
  const jobs = Jobs.load(join(dir, 'jobs.json'));
  const budget = new Budget({ cap: cap ?? null, known: knownCosts(design) });
  for (const [recorded, kind] of KIND_OF_STAGE) {
    const credits = jobs.lastCredits(recorded);
    if (credits !== null) budget.observe(kind, credits);
  }
  const only = values.only?.split(',').map((s) => s.trim()).filter(Boolean);
  const context = { design, jobs, dir, budget, only, again: values.again === true, concurrency, log: console.log };

  const plan = planStage(stage, context);
  for (const line of formatPlan(plan)) console.log(line);
  for (const line of formatPlanTotals(plan)) console.log(line);
  if (dryRun) return 0;

  const api = deps.api();
  const balance = await api.balance();
  console.log(`Meshy balance: ${balance} credits`);
  const needed = plan.filter((i) => i.action === 'create').reduce((sum, i) => sum + (i.credits ?? 0), 0);
  if (needed > balance) throw new RefusedError(`this run needs about ${needed} credits but the balance is ${balance}`);
  if (cap !== undefined && cap > balance) console.log(`note: --max-credits ${cap} is more than the balance of ${balance}`);

  const report = await runStage(stage, { ...context, api });
  for (const line of formatSummary(stage, report)) console.log(line);
  return report.failed > 0 || report.stopped ? 1 : 0;
}

function pickCommand(argv: string[]): number {
  const { positionals } = parsed(() => parseArgs({ args: argv, allowPositionals: true, strict: true, options: {} }));
  const [dir, piece, stage, n] = positionals;
  if (!dir || !piece || !stage || !n) throw new UsageError('pick expects <set-dir> <piece> <stage> <n>');
  if (!ALL_PIECE_KEYS.includes(piece)) throw new UsageError(`unknown piece "${piece}"; expected one of ${ALL_PIECE_KEYS.join(', ')}`);
  const key = PICKABLE.find((s) => s === stage);
  if (!key) throw new UsageError(`stage must be one of ${PICKABLE.join(', ')}`);
  const attempt = Number(n);
  if (!Number.isInteger(attempt)) throw new UsageError(`<n> must be a whole number, got "${n}"`);
  Jobs.load(join(dir, 'jobs.json')).select(piece, key, attempt);
  console.log(`${piece} ${key}: attempt ${attempt} is now the one used`);
  return 0;
}

function assembleCommand(argv: string[]): number {
  const { positionals } = parsed(() => parseArgs({ args: argv, allowPositionals: true, strict: true, options: {} }));
  const [dir] = positionals;
  if (!dir) throw new UsageError('assemble expects <set-dir>');
  const set = assemble(dir);
  console.log(`wrote ${join(dir, 'set.json')} for ${Object.keys(set.pieces).length} pieces`);
  console.log(`next: pnpm art build-set ${dir} public/packs/sets/${set.id}`);
  return 0;
}

export const GENERATION_COMMANDS: Record<string, (argv: string[], deps: CliDeps) => Promise<number> | number> = {
  'init-set': (argv) => initSetCommand(argv),
  balance: (_argv, deps) => balanceCommand(deps),
  actions: actionsCommand,
  generate: generateCommand,
  pick: (argv) => pickCommand(argv),
  assemble: (argv) => assembleCommand(argv),
};
