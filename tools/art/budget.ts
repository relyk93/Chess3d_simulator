import type { Design } from './design';
import type { TaskKind } from './meshy/api';

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

/** Text-to-image prices from Meshy's documentation. */
const TEXT_TO_IMAGE_CREDITS: Record<string, number> = {
  'nano-banana': 3,
  'nano-banana-2': 6,
  'nano-banana-pro': 9,
  'gpt-image-2': 9,
  'gpt-image-2-5-flare': 9,
  'gpt-image-2-5-sunburst': 9,
};

/**
 * What each task costs, as far as Meshy documents it: rigging 5, one animation 3, text-to-image by
 * model. Image-to-3D is not documented, so it is only here once the design file supplies it.
 */
export function knownCosts(design: Pick<Design, 'textToImageModel' | 'credits'>): Partial<Record<TaskKind, number>> {
  const costs: Partial<Record<TaskKind, number>> = { rigging: 5, animations: 3 };
  const image = TEXT_TO_IMAGE_CREDITS[design.textToImageModel];
  if (image !== undefined) costs['text-to-image'] = image;
  if (design.credits.imageTo3d !== null) costs['image-to-3d'] = design.credits.imageTo3d;
  return costs;
}

export interface BudgetOptions {
  /** The most credits this run may spend, or `null` for no limit. */
  cap: number | null;
  known?: Partial<Record<TaskKind, number>>;
}

/**
 * Tracks what a run has spent and has promised to spend. A task is reserved before it is created and
 * settled with the cost Meshy reports. A reported cost replaces the documented one, so a price change
 * is picked up after the first task.
 */
export class Budget {
  spent = 0;
  private reserved = 0;
  private readonly observed: Partial<Record<TaskKind, number>> = {};
  private readonly cap: number | null;
  private readonly known: Partial<Record<TaskKind, number>>;

  constructor(opts: BudgetOptions) {
    this.cap = opts.cap;
    this.known = opts.known ?? {};
  }

  estimate(kind: TaskKind): number | null {
    return this.observed[kind] ?? this.known[kind] ?? null;
  }

  isKnown(kind: TaskKind): boolean {
    return this.estimate(kind) !== null;
  }

  /**
   * Holds the estimated cost of a task about to be created and returns the amount held. Throws if it
   * would pass the cap. An unknown cost holds nothing, so callers run the first such task alone.
   */
  reserve(kind: TaskKind): number {
    const estimate = this.estimate(kind);
    if (estimate === null) return 0;
    const committed = this.spent + this.reserved;
    if (this.cap !== null && committed + estimate > this.cap) {
      throw new BudgetError(`${kind} task would pass the ${this.cap} credit cap (${committed} spent or reserved, ${estimate} more needed)`);
    }
    this.reserved += estimate;
    return estimate;
  }

  /** A task finished. Charges the reported cost, or the held amount if none was reported. */
  settle(kind: TaskKind, hold: number, actual: number | null): void {
    this.reserved -= hold;
    this.spent += actual ?? hold;
    if (actual !== null) this.observed[kind] = actual;
  }

  /** A task failed or never started: Meshy refunds it, so nothing is spent and nothing is learned. */
  release(hold: number): void {
    this.reserved -= hold;
  }
}
