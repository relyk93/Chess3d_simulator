import type { Accessor, Document } from '@gltf-transform/core';
import { NormalizeError } from './spec';

export interface ClipSource {
  /** The name the copied clip gets in the base document. */
  name: string;
  doc: Document;
}

/**
 * Copies the first animation of each source document onto `base`, matching channel targets by
 * node name. Sources are the per-action glb files Meshy's Animation API returns for one rig.
 * Returns warnings about skipped channels.
 */
export function mergeClips(base: Document, piece: string, sources: readonly ClipSource[]): string[] {
  const warnings: string[] = [];
  const buffer = base.getRoot().listBuffers()[0] ?? base.createBuffer();
  const nodes = new Map(base.getRoot().listNodes().map((n) => [n.getName(), n] as const));
  const copy = (a: Accessor) =>
    base
      .createAccessor()
      .setType(a.getType())
      .setArray(a.getArray()?.slice() ?? new Float32Array(0))
      .setNormalized(a.getNormalized())
      .setBuffer(buffer);

  for (const { name, doc } of sources) {
    const source = doc.getRoot().listAnimations()[0];
    if (!source) throw new NormalizeError(piece, `the animation file for "${name}" contains no animation`);

    const out = base.createAnimation(name);
    let matched = 0;
    const channels = source.listChannels();
    for (const channel of channels) {
      const node = nodes.get(channel.getTargetNode()?.getName() ?? '');
      const sampler = channel.getSampler();
      const path = channel.getTargetPath();
      const input = sampler?.getInput();
      const output = sampler?.getOutput();
      if (!node || !sampler || !path || !input || !output) continue;
      const copied = base
        .createAnimationSampler()
        .setInput(copy(input))
        .setOutput(copy(output))
        .setInterpolation(sampler.getInterpolation());
      out.addSampler(copied).addChannel(base.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(copied));
      matched++;
    }

    if (matched === 0) {
      out.dispose();
      throw new NormalizeError(
        piece,
        `no channel in the "${name}" animation matches a node in the base model; was it made from the same rig?`,
      );
    }
    if (matched < channels.length) {
      warnings.push(`"${name}": ${channels.length - matched} of ${channels.length} channels target nodes missing from the base model and were skipped`);
    }
  }
  return warnings;
}
