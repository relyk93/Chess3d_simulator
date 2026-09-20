import { join } from 'node:path';
import { UsageError } from './args';
import { BudgetError, type Budget } from './budget';
import { DesignError, poseModeFor, type Design } from './design';
import type { Attempt, Jobs, StageKey } from './jobs';
import type { MeshyApi, TaskKind } from './meshy/api';
import { MeshyError, MeshyTaskError } from './meshy/client';
import { animationBody, imageTo3dBody, resultUrl, riggingBody, textToImageBody } from './meshy/endpoints';
import { buildPrompt } from './prompts';
import { ALL_PIECE_KEYS, CLIP_NAMES } from './spec';

/** The four steps from a name to an animated model. `animate` runs one task per clip. */
export type Stage = 'concept' | 'model' | 'rig' | 'animate';

export interface StageContext {
  api: MeshyApi;
  design: Design;
  jobs: Jobs;
  /** The set's source folder. Downloaded files go beneath it. */
  dir: string;
  budget: Budget;
  /** Piece keys to work on. Default: all twelve. */
  only?: readonly string[];
  /** Create a new attempt even for a piece that already has a good one. */
  again?: boolean;
  /** Tasks in flight at once. Default 2, well under Meshy's queue limit. */
  concurrency?: number;
  log?: (line: string) => void;
}

export interface PlanItem {
  piece: string;
  stage: StageKey;
  action: 'create' | 'resume' | 'skip' | 'blocked';
  reason?: string;
  /** Credits this would cost, or null when Meshy has not said what this kind of task costs. */
  credits: number | null;
}

export interface StageReport {
  /** Tasks created this run, whether or not they finished. */
  created: number;
  resumed: number;
  skipped: number;
  blocked: number;
  /** Tasks, created or resumed, that did not finish. Their errors are in `failures`. */
  failed: number;
  /** Work that was never started because the run stopped. */
  unstarted: number;
  creditsSpent: number;
  /** Why the run stopped early, or null. */
  stopped: string | null;
  failures: { piece: string; stage: StageKey; message: string }[];
}

interface Unit {
  piece: string;
  stage: StageKey;
  kind: TaskKind;
}

type Decision =
  | { action: 'create' }
  | { action: 'resume'; attempt: Attempt; number: number }
  | { action: 'skip'; reason: string }
  | { action: 'blocked'; reason: string };

const isClip = (stage: StageKey) => (CLIP_NAMES as readonly string[]).includes(stage);
const label = (u: Unit) => `${u.piece} ${u.stage}`;

/** Meshy errors that will hit every remaining task the same way, so the run should stop. */
const RUN_STOPPING = new Set([401, 402, 429]);

function piecesInScope(ctx: Omit<StageContext, 'api'>): string[] {
  const only = ctx.only;
  if (!only) return [...ALL_PIECE_KEYS];
  for (const piece of only) {
    if (!ALL_PIECE_KEYS.includes(piece)) {
      throw new UsageError(`--only: unknown piece "${piece}"; expected any of ${ALL_PIECE_KEYS.join(', ')}`);
    }
  }
  return ALL_PIECE_KEYS.filter((k) => only.includes(k));
}

function unitsFor(stage: Stage, ctx: Omit<StageContext, 'api'>): Unit[] {
  const pieces = piecesInScope(ctx);
  switch (stage) {
    case 'concept':
      return pieces.map((piece) => ({ piece, stage: 'concept', kind: 'text-to-image' }));
    case 'model':
      return pieces.map((piece) => ({ piece, stage: 'model', kind: 'image-to-3d' }));
    case 'rig':
      return pieces.map((piece) => ({ piece, stage: 'rig', kind: 'rigging' }));
    case 'animate': {
      const rigged = pieces.filter((p) => ctx.design.pieces[p]?.rigged);
      const unset = CLIP_NAMES.filter((clip) => ctx.design.actions[clip] === null);
      if (rigged.length > 0 && unset.length > 0) {
        throw new DesignError(
          'actions',
          `no action id for ${unset.join(', ')}; find them with "pnpm art actions --search <word>" and set them in design.json`,
        );
      }
      return rigged.flatMap((piece) => CLIP_NAMES.map((clip) => ({ piece, stage: clip, kind: 'animations' as const })));
    }
  }
}

function missingPrerequisite(u: Unit, ctx: Omit<StageContext, 'api'>): string | null {
  if (u.stage === 'model' && !ctx.jobs.selected(u.piece, 'concept')) return 'no succeeded concept yet; run --stage concept first';
  if (u.stage === 'rig' && !ctx.jobs.selected(u.piece, 'model')) return 'no succeeded model yet; run --stage model first';
  if (isClip(u.stage) && !ctx.jobs.selected(u.piece, 'rig')) return 'no succeeded rig yet; run --stage rig first';
  return null;
}

function decide(u: Unit, ctx: Omit<StageContext, 'api'>): Decision {
  const attempts = ctx.jobs.attempts(u.piece, u.stage);
  let open = -1;
  attempts.forEach((a, i) => {
    if (a.status === 'PENDING' || a.status === 'IN_PROGRESS') open = i;
  });
  if (open >= 0) return { action: 'resume', attempt: attempts[open]!, number: open + 1 };

  if ((u.stage === 'rig' || isClip(u.stage)) && !ctx.design.pieces[u.piece]?.rigged) {
    return { action: 'skip', reason: 'rigid piece; uses the fallback motion' };
  }
  if (!ctx.again && ctx.jobs.selected(u.piece, u.stage)) {
    return { action: 'skip', reason: `already done (attempt ${ctx.jobs.selectedNumber(u.piece, u.stage)})` };
  }
  const missing = missingPrerequisite(u, ctx);
  return missing ? { action: 'blocked', reason: missing } : { action: 'create' };
}

/** The request body for a unit whose prerequisites are met. */
function requestFor(u: Unit, ctx: StageContext): object {
  const { design, jobs } = ctx;
  const piece = design.pieces[u.piece]!;
  const upstream = (stage: StageKey) => jobs.selected(u.piece, stage)!.taskId;
  switch (u.stage) {
    case 'concept':
      return textToImageBody(buildPrompt(design, u.piece), { aiModel: design.textToImageModel, poseMode: poseModeFor(piece) });
    case 'model':
      return imageTo3dBody(upstream('concept'), {
        aiModel: design.imageTo3dModel,
        targetPolycount: design.targetPolycount,
        poseMode: poseModeFor(piece),
      });
    case 'rig':
      return riggingBody(upstream('model'), design.heightMeters);
    default:
      return animationBody(upstream('rig'), design.actions[u.stage]!);
  }
}

function fileFor(u: Unit, n: number): string {
  switch (u.stage) {
    case 'concept':
      return `concepts/${u.piece}-${n}.png`;
    case 'model':
      return `models/${u.piece}-${n}.glb`;
    case 'rig':
      return `rigged/${u.piece}-${n}.glb`;
    default:
      return `anims/${u.piece}/${u.stage}-${n}.glb`;
  }
}

/** What a run would do, without creating anything or calling Meshy, so it takes no API at all. */
export function planStage(stage: Stage, ctx: Omit<StageContext, 'api'>): PlanItem[] {
  return unitsFor(stage, ctx).map((u) => {
    const d = decide(u, ctx);
    if (d.action === 'create') return { piece: u.piece, stage: u.stage, action: 'create', credits: ctx.budget.estimate(u.kind) };
    if (d.action === 'resume') return { piece: u.piece, stage: u.stage, action: 'resume', credits: 0 };
    return { piece: u.piece, stage: u.stage, action: d.action, reason: d.reason, credits: 0 };
  });
}

interface Work {
  unit: Unit;
  decision: Extract<Decision, { action: 'create' | 'resume' }>;
}

interface RunState {
  stop: string | null;
}

async function runPool<T>(items: T[], size: number, work: (item: T) => Promise<void>, stopped: () => boolean): Promise<number> {
  let next = 0;
  const worker = async () => {
    while (!stopped()) {
      const i = next++;
      if (i >= items.length) return;
      await work(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, worker));
  return items.length - Math.min(next, items.length);
}

export async function runStage(stage: Stage, ctx: StageContext): Promise<StageReport> {
  const log = ctx.log ?? (() => {});
  const units = unitsFor(stage, ctx);
  const report: StageReport = { created: 0, resumed: 0, skipped: 0, blocked: 0, failed: 0, unstarted: 0, creditsSpent: 0, stopped: null, failures: [] };
  const state: RunState = { stop: null };

  const resumes: Work[] = [];
  const creates: Work[] = [];
  for (const unit of units) {
    const decision = decide(unit, ctx);
    if (decision.action === 'skip') {
      report.skipped++;
      log(`${label(unit)}: skipped (${decision.reason})`);
    } else if (decision.action === 'blocked') {
      report.blocked++;
      log(`${label(unit)}: blocked (${decision.reason})`);
    } else {
      (decision.action === 'resume' ? resumes : creates).push({ unit, decision });
    }
  }

  const recordFailure = (u: Unit, e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    report.failed++;
    report.failures.push({ piece: u.piece, stage: u.stage, message });
    log(`${label(u)}: FAILED - ${message}`);
    if (e instanceof MeshyError && RUN_STOPPING.has(e.status)) state.stop ??= e.message;
    return message;
  };

  const process = async ({ unit, decision }: Work): Promise<void> => {
    const { api, jobs, budget, dir } = ctx;
    let hold = 0;
    let taskId: string;
    let number: number;

    if (decision.action === 'create') {
      try {
        hold = budget.reserve(unit.kind);
      } catch (e) {
        if (!(e instanceof BudgetError)) throw e;
        state.stop ??= e.message;
        report.unstarted++;
        return;
      }
      log(`${label(unit)}: creating ${unit.kind} task`);
      try {
        taskId = await api.create(unit.kind, requestFor(unit, ctx));
      } catch (e) {
        budget.release(hold);
        recordFailure(unit, e);
        return;
      }
      number = jobs.add(unit.piece, unit.stage, { taskId, status: 'PENDING', file: null, credits: null, error: null });
      report.created++;
    } else {
      taskId = decision.attempt.taskId;
      number = decision.number;
      report.resumed++;
      log(`${label(unit)}: resuming task ${taskId}`);
    }

    try {
      const task = await api.wait(unit.kind, taskId);
      const file = fileFor(unit, number);
      await api.download(resultUrl(unit.kind, task), join(dir, file));
      const credits = typeof task.consumed_credits === 'number' ? task.consumed_credits : null;
      jobs.update(unit.piece, unit.stage, taskId, { status: 'SUCCEEDED', file, credits, error: null });
      if (decision.action === 'create') budget.settle(unit.kind, hold, credits);
      else if (credits !== null) budget.observe(unit.kind, credits);
      log(`${label(unit)}: done -> ${file}${credits === null ? '' : ` (${credits} credits)`}`);
      const inUse = jobs.selectedNumber(unit.piece, unit.stage);
      if (inUse !== null && inUse !== number) {
        log(`${label(unit)}: attempt ${number} is not the selected one (attempt ${inUse}); use: pnpm art pick <set-dir> ${unit.piece} ${unit.stage} ${number}`);
      }
    } catch (e) {
      // A failed or canceled task is refunded, so it is final. Anything else (a timeout, a download
      // error, a result that could not be read) leaves a task Meshy may already have charged for, so
      // it stays open to be picked up again and counts against the budget.
      const terminal = e instanceof MeshyTaskError && e.terminal;
      if (terminal) budget.release(hold);
      else budget.settle(unit.kind, hold, null);
      const message = recordFailure(unit, e);
      jobs.update(unit.piece, unit.stage, taskId, terminal ? { status: 'FAILED', error: message } : { error: message });
    }
  };

  const size = Math.max(1, ctx.concurrency ?? 2);
  const stopped = () => state.stop !== null;

  // Await first: `x += await y` reads x before the await and would drop increments made meanwhile.
  const leftOfResumes = await runPool(resumes, size, process, stopped);
  report.unstarted += leftOfResumes;

  if (state.stop !== null) {
    report.unstarted += creates.length;
  } else {
    // A kind of task with no known cost cannot be budgeted, so the first one runs alone. Its reported
    // cost then lets the rest be reserved against the cap.
    const first = creates.find((w) => !ctx.budget.isKnown(w.unit.kind));
    let rest = creates;
    if (first) {
      rest = creates.filter((w) => w !== first);
      await process(first);
      if (state.stop === null && ctx.budget.capped && !ctx.budget.isKnown(first.unit.kind)) {
        state.stop = `the cost of ${first.unit.kind} tasks is still unknown, so the credit cap cannot be enforced; set credits.imageTo3d in design.json, or fix the failure above and run again`;
      }
    }
    if (state.stop !== null) report.unstarted += rest.length;
    else {
      const leftOfRest = await runPool(rest, size, process, stopped);
      report.unstarted += leftOfRest;
    }
  }

  report.creditsSpent = ctx.budget.spent;
  report.stopped = state.stop;
  return report;
}
