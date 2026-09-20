import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TaskStatus } from './meshy/api';
import type { ClipName } from './spec';

/** One step of a piece's pipeline. Animation stages are named for the clip they produce. */
export type StageKey = 'concept' | 'model' | 'rig' | ClipName;

/** One Meshy task for one piece and stage. A stage keeps every attempt so results can be compared. */
export interface Attempt {
  taskId: string;
  status: TaskStatus;
  /** Where the downloaded result was saved, relative to the set folder. */
  file: string | null;
  credits: number | null;
  error: string | null;
}

interface StageState {
  attempts: Attempt[];
  /** 1-based attempt number chosen with `select`, or null to use the latest that succeeded. */
  selected: number | null;
}

interface JobsFile {
  version: 1;
  pieces: Record<string, Partial<Record<StageKey, StageState>>>;
}

export class JobsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobsError';
  }
}

/**
 * Everything the generation tools have created, in `jobs.json`. Task ids are recorded here before
 * anything waits on them, so an interrupted run resumes instead of paying for the same task twice.
 */
export class Jobs {
  private constructor(
    private readonly path: string,
    private readonly data: JobsFile,
  ) {}

  static load(path: string): Jobs {
    if (!existsSync(path)) return new Jobs(path, { version: 1, pieces: {} });
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new JobsError(`${path} is not a valid jobs file (${e instanceof Error ? e.message : String(e)}); fix or delete it`);
    }
    const file = parsed as Partial<JobsFile> | null;
    if (!file || file.version !== 1 || typeof file.pieces !== 'object' || file.pieces === null) {
      throw new JobsError(`${path} is not a valid jobs file (expected version 1 with a "pieces" object); fix or delete it`);
    }
    return new Jobs(path, file as JobsFile);
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2) + '\n');
    renameSync(temp, this.path);
  }

  private stage(piece: string, stage: StageKey): StageState | undefined {
    return this.data.pieces[piece]?.[stage];
  }

  attempts(piece: string, stage: StageKey): readonly Attempt[] {
    return [...(this.stage(piece, stage)?.attempts ?? [])];
  }

  /** Records a new attempt and returns its number, counting from 1. */
  add(piece: string, stage: StageKey, attempt: Attempt): number {
    const stages = (this.data.pieces[piece] ??= {});
    const state = (stages[stage] ??= { attempts: [], selected: null });
    state.attempts.push({ ...attempt });
    this.save();
    return state.attempts.length;
  }

  update(piece: string, stage: StageKey, taskId: string, patch: Partial<Attempt>): void {
    const found = this.stage(piece, stage)?.attempts.find((a) => a.taskId === taskId);
    if (!found) throw new JobsError(`no attempt "${taskId}" for ${piece} ${stage}`);
    Object.assign(found, patch);
    this.save();
  }

  /** The attempt later stages build on: the one picked with `select`, else the latest that succeeded. */
  selected(piece: string, stage: StageKey): Attempt | null {
    const state = this.stage(piece, stage);
    if (!state) return null;
    const picked = state.selected === null ? undefined : state.attempts[state.selected - 1];
    if (picked?.status === 'SUCCEEDED') return picked;
    return [...state.attempts].reverse().find((a) => a.status === 'SUCCEEDED') ?? null;
  }

  /** The number (from 1) of the attempt `selected` would return, for filenames and messages. */
  selectedNumber(piece: string, stage: StageKey): number | null {
    const chosen = this.selected(piece, stage);
    const state = this.stage(piece, stage);
    return chosen && state ? state.attempts.indexOf(chosen) + 1 : null;
  }

  select(piece: string, stage: StageKey, n: number): void {
    const state = this.stage(piece, stage);
    if (!state || state.attempts.length === 0) throw new JobsError(`${piece} ${stage} has no attempts`);
    if (!Number.isInteger(n) || n < 1 || n > state.attempts.length) {
      throw new JobsError(`${piece} ${stage} has ${state.attempts.length} attempts; choose 1 to ${state.attempts.length}`);
    }
    const attempt = state.attempts[n - 1]!;
    if (attempt.status !== 'SUCCEEDED') {
      throw new JobsError(`attempt ${n} of ${piece} ${stage} did not succeed (${attempt.status})`);
    }
    state.selected = n;
    this.save();
  }

  totalCredits(): number {
    let total = 0;
    for (const stages of Object.values(this.data.pieces)) {
      for (const state of Object.values(stages)) {
        for (const attempt of state?.attempts ?? []) total += attempt.credits ?? 0;
      }
    }
    return total;
  }
}
