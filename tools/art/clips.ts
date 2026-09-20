import type { Animation, Document } from '@gltf-transform/core';
import { CLIP_NAMES, NormalizeError, type ClipName } from './spec';

export interface ClipOptions {
  /** Source clip name to standard clip name. `null` deletes the clip, for a rig's walk and run cycles. */
  rename: Record<string, string | null>;
  /** Clips the manifest lists for this piece. Standard clips not listed here are stripped. */
  keep: readonly ClipName[];
}

export interface ClipReport {
  clips: ClipName[];
  warnings: string[];
}

const isStandard = (name: string): name is ClipName => (CLIP_NAMES as readonly string[]).includes(name);

/** Disposing an animation alone leaves its channels and samplers, and so their keyframe accessors, in the file. */
export function dropClip(anim: Animation): void {
  for (const channel of anim.listChannels()) {
    const sampler = channel.getSampler();
    channel.dispose();
    sampler?.dispose();
  }
  anim.dispose();
}

export function applyClips(doc: Document, piece: string, opts: ClipOptions): ClipReport {
  const root = doc.getRoot();
  const warnings: string[] = [];

  for (const anim of root.listAnimations()) {
    const from = anim.getName();
    if (!Object.hasOwn(opts.rename, from)) continue;
    const to = opts.rename[from];
    if (to === null || to === undefined) dropClip(anim);
    else anim.setName(to);
  }

  const strays = root.listAnimations().map((a) => a.getName()).filter((n) => !isStandard(n));
  if (strays.length > 0) {
    throw new NormalizeError(
      piece,
      `clips outside the standard five remain: ${strays.map((s) => JSON.stringify(s)).join(', ')}. ` +
        `Map each with --rename "name=idle|attack|hit|die|victory", or "name=" to delete it.`,
    );
  }

  const seen = new Set<string>();
  for (const anim of root.listAnimations()) {
    if (seen.has(anim.getName())) throw new NormalizeError(piece, `two clips are named "${anim.getName()}"`);
    seen.add(anim.getName());
  }

  for (const anim of root.listAnimations()) {
    if (!opts.keep.includes(anim.getName() as ClipName)) dropClip(anim);
  }

  const have = root.listAnimations().map((a) => a.getName());
  const missing = opts.keep.filter((c) => !have.includes(c));
  if (missing.length > 0) {
    throw new NormalizeError(piece, `the manifest lists clips the model does not have: ${missing.join(', ')}`);
  }

  const idle = root.listAnimations().find((a) => a.getName() === 'idle');
  if (idle) {
    const snapped = closeLoop(idle);
    if (snapped > 0) warnings.push(`idle did not loop; snapped the last keyframe of ${snapped} channel(s) to the first`);
    if (idle.listChannels().some((c) => c.getSampler()?.getInterpolation() === 'CUBICSPLINE')) {
      warnings.push('idle has cubic-spline channels; their loop was not checked');
    }
  }

  return { clips: CLIP_NAMES.filter((c) => have.includes(c)), warnings };
}

/** Makes each channel's last keyframe equal its first. Cubic-spline channels are skipped. Returns how many changed. */
export function closeLoop(anim: Animation): number {
  let snapped = 0;
  for (const channel of anim.listChannels()) {
    const sampler = channel.getSampler();
    const output = sampler?.getOutput();
    const values = output?.getArray();
    if (!sampler || !output || !values || sampler.getInterpolation() === 'CUBICSPLINE') continue;
    const width = output.getElementSize();
    const last = values.length - width;
    let differs = false;
    for (let i = 0; i < width; i++) {
      if (Math.abs((values[last + i] ?? 0) - (values[i] ?? 0)) > 1e-4) differs = true;
    }
    if (!differs) continue;
    for (let i = 0; i < width; i++) values[last + i] = values[i] ?? 0;
    output.setArray(values);
    snapped++;
  }
  return snapped;
}
