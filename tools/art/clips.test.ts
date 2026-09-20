// @vitest-environment node
import { applyClips, closeLoop } from './clips';
import { statueDoc } from './testing/fixtures';

const names = (doc: Awaited<ReturnType<typeof statueDoc>>) => doc.getRoot().listAnimations().map((a) => a.getName());

describe('applyClips', () => {
  test('renames from the map and reports clips in the standard order', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Armature|Attack', 'Armature|Idle'] });
    const report = applyClips(doc, 'w-king', {
      rename: { 'Armature|Attack': 'attack', 'Armature|Idle': 'idle' },
      keep: ['idle', 'attack'],
    });
    expect(report.clips).toEqual(['idle', 'attack']);
    expect(names(doc).sort()).toEqual(['attack', 'idle']);
  });

  test('a null mapping deletes a clip such as a rig walk cycle', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Walking', 'idle'] });
    const report = applyClips(doc, 'w-king', { rename: { Walking: null }, keep: ['idle'] });
    expect(report.clips).toEqual(['idle']);
    expect(names(doc)).toEqual(['idle']);
  });

  test('a clip outside the standard five is an error that says how to fix it', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Walking', 'idle'] });
    expect(() => applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] })).toThrow(
      /w-king: clips outside the standard five remain: "Walking".*--rename/,
    );
  });

  test('standard clips not listed in keep are stripped', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle', 'attack', 'hit'] });
    const report = applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] });
    expect(report.clips).toEqual(['idle']);
    expect(names(doc)).toEqual(['idle']);
  });

  test('an empty keep list strips every clip, for the rigid pieces', async () => {
    const doc = await statueDoc({ clips: ['idle', 'attack'] });
    expect(applyClips(doc, 'w-pawn', { rename: {}, keep: [] }).clips).toEqual([]);
    expect(names(doc)).toEqual([]);
  });

  test('a clip listed in keep but missing from the model is an error', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'] });
    expect(() => applyClips(doc, 'w-king', { rename: {}, keep: ['idle', 'die'] })).toThrow(
      /w-king: the manifest lists clips the model does not have: die/,
    );
  });

  test('two clips mapped to the same name are an error', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['a', 'b'] });
    expect(() => applyClips(doc, 'w-king', { rename: { a: 'attack', b: 'attack' }, keep: ['attack'] })).toThrow(
      /w-king: two clips are named "attack"/,
    );
  });

  test('an idle clip that does not loop is closed, with a warning', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'], openIdle: true });
    const report = applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] });
    expect(report.warnings).toEqual(['idle did not loop; snapped the last keyframe of 1 channel(s) to the first']);
    const out = doc.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput()!.getArray()!;
    expect(Array.from(out.slice(-3))).toEqual(Array.from(out.slice(0, 3)));
  });

  test('an idle clip that already loops gives no warning', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'] });
    expect(applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] }).warnings).toEqual([]);
  });
});

describe('closeLoop', () => {
  test('returns 0 when the loop is already closed', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'] });
    expect(closeLoop(doc.getRoot().listAnimations()[0]!)).toBe(0);
  });
});
