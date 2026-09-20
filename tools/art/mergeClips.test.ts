// @vitest-environment node
import { mergeClips } from './mergeClips';
import { readGlb, statueDoc, statueGlb } from './testing/fixtures';

describe('mergeClips', () => {
  test('copies a clip onto the base, retargeting the channel by node name', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true, clips: ['Armature|Attack'] });
    const warnings = mergeClips(base, 'w-king', [{ name: 'attack', doc: source }]);

    expect(warnings).toEqual([]);
    const anim = base.getRoot().listAnimations()[0]!;
    expect(anim.getName()).toBe('attack');
    const channel = anim.listChannels()[0]!;
    expect(channel.getTargetNode()).toBe(base.getRoot().listNodes().find((n) => n.getName() === 'tip'));
    expect(channel.getTargetPath()).toBe('translation');
    expect(Array.from(channel.getSampler()!.getOutput()!.getArray()!)).toEqual([0, 1, 0, 0, expect.closeTo(1.1, 5), 0]);
  });

  test('clones the data, so the source document is not shared', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true, clips: ['x'] });
    mergeClips(base, 'w-king', [{ name: 'hit', doc: source }]);
    const copied = base.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput();
    const original = source.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput();
    expect(copied).not.toBe(original);
    expect(copied!.getArray()).not.toBe(original!.getArray());
  });

  test('merges several sources and the result survives a glb round trip', async () => {
    const base = await statueDoc({ skinned: true });
    mergeClips(base, 'w-queen', [
      { name: 'attack', doc: await readGlb(await statueGlb({ skinned: true, clips: ['a'] })) },
      { name: 'die', doc: await readGlb(await statueGlb({ skinned: true, clips: ['b'] })) },
    ]);
    const names = base.getRoot().listAnimations().map((a) => a.getName()).sort();
    expect(names).toEqual(['attack', 'die']);
  });

  test('a source built on a different rig is an error', async () => {
    const base = await statueDoc();
    const source = await statueDoc({ skinned: true, clips: ['Attack'] });
    expect(() => mergeClips(base, 'w-king', [{ name: 'attack', doc: source }])).toThrow(
      /w-king: no channel in the "attack" animation matches a node in the base model; was it made from the same rig\?/,
    );
    expect(base.getRoot().listAnimations()).toHaveLength(0);
  });

  test('a source with no animation is an error', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true });
    expect(() => mergeClips(base, 'w-king', [{ name: 'attack', doc: source }])).toThrow(
      /w-king: the animation file for "attack" contains no animation/,
    );
  });

  test('warns about channels whose target node is missing from the base', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true, clips: ['Attack'] });
    const anim = source.getRoot().listAnimations()[0]!;
    const first = anim.listChannels()[0]!.getSampler()!;
    const ghost = source.createNode('ghost');
    const sampler = source
      .createAnimationSampler()
      .setInput(first.getInput())
      .setOutput(first.getOutput())
      .setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(source.createAnimationChannel().setTargetNode(ghost).setTargetPath('translation').setSampler(sampler));

    const warnings = mergeClips(base, 'w-king', [{ name: 'attack', doc: source }]);
    expect(warnings).toEqual(['"attack": 1 of 2 channels target nodes missing from the base model and were skipped']);
  });
});
