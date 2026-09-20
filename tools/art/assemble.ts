import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PieceSource, SetSource } from './buildSet';
import { loadDesign } from './design';
import { Jobs, type StageKey } from './jobs';
import { ALL_PIECE_KEYS, CLIP_NAMES, type ClipName } from './spec';

export class AssembleError extends Error {
  constructor(problems: string[]) {
    super(`cannot assemble: ${problems.length} problems\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'AssembleError';
  }
}

/**
 * Turns a generated set's results into the `set.json` that `build-set` reads. A rigged piece uses its
 * rig, drops the walk and run clips that come with it, and merges the five animation files. A rigid
 * piece uses its plain model. Uses each stage's selected attempt. Reports every missing result at
 * once, and writes nothing unless the whole set is complete.
 */
export function assemble(dir: string): SetSource {
  const design = loadDesign(dir);
  const jobs = Jobs.load(join(dir, 'jobs.json'));
  const problems: string[] = [];

  const resultFile = (piece: string, stage: StageKey, noun: string, fix: string): string | null => {
    const attempt = jobs.selected(piece, stage);
    if (!attempt?.file) {
      problems.push(`${piece} ${stage}: no ${noun} yet; run --stage ${fix}`);
      return null;
    }
    if (!existsSync(join(dir, attempt.file))) {
      problems.push(`${piece} ${stage}: file ${attempt.file} is missing on disk`);
      return null;
    }
    return attempt.file;
  };

  const pieces: Record<string, PieceSource> = {};
  for (const key of ALL_PIECE_KEYS) {
    const spec = design.pieces[key]!;
    const rotate = spec.rotateY === undefined ? {} : { rotateY: spec.rotateY };
    if (!spec.rigged) {
      const model = resultFile(key, 'model', 'model', 'model');
      if (model) pieces[key] = { model, ...rotate };
      continue;
    }
    const rig = resultFile(key, 'rig', 'rig', 'rig');
    const clips: Partial<Record<ClipName, string>> = {};
    for (const clip of CLIP_NAMES) {
      const file = resultFile(key, clip, 'animation', 'animate');
      if (file) clips[clip] = file;
    }
    if (rig) pieces[key] = { model: rig, keep: [...CLIP_NAMES], dropBaseClips: true, clips, ...rotate };
  }

  for (const [sound, file] of Object.entries(design.audio)) {
    if (!existsSync(join(dir, file))) problems.push(`audio ${sound}: file ${file} is missing on disk`);
  }

  if (problems.length > 0) throw new AssembleError(problems);

  const set: SetSource = {
    id: design.id,
    name: design.name,
    version: design.version,
    sides: design.sides,
    audio: design.audio,
    pieces,
  };
  writeFileSync(join(dir, 'set.json'), JSON.stringify(set, null, 2) + '\n');
  return set;
}
