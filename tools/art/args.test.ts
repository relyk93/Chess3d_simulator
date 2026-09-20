// @vitest-environment node
import { parseNormalizeArgs, UsageError } from './args';

const base = ['--piece', 'w-king', '--in', 'raw/w-king.glb', '--out', 'out/w-king.glb'];

describe('parseNormalizeArgs', () => {
  test('parses a full command', () => {
    const cmd = parseNormalizeArgs([
      ...base,
      '--keep', 'idle,attack',
      '--rename', 'Armature|Attack=attack',
      '--rename', 'Walking=',
      '--anim', 'hit=raw/hit.glb',
      '--rotate-y', '180',
      '--max-texture', '2048',
    ]);
    expect(cmd.input).toBe('raw/w-king.glb');
    expect(cmd.output).toBe('out/w-king.glb');
    expect(cmd.anims).toEqual([{ name: 'hit', path: 'raw/hit.glb' }]);
    expect(cmd.options).toEqual({
      piece: 'w-king',
      keep: ['idle', 'attack'],
      rename: { 'Armature|Attack': 'attack', Walking: null },
      rotateYDeg: 180,
      maxTexturePx: 2048,
    });
  });

  test('defaults to a rigid piece with no renames', () => {
    expect(parseNormalizeArgs(base).options).toEqual({ piece: 'w-king', keep: [], rename: {} });
  });

  test.each(['--piece', '--in', '--out'])('requires %s', (flag) => {
    const i = base.indexOf(flag);
    const argv = [...base.slice(0, i), ...base.slice(i + 2)];
    expect(() => parseNormalizeArgs(argv)).toThrow(new RegExp(`${flag} is required`));
  });

  test('rejects a clip name that is not one of the standard five', () => {
    expect(() => parseNormalizeArgs([...base, '--keep', 'idle,walk'])).toThrow(/"walk" is not one of idle, attack, hit, die, victory/);
    expect(() => parseNormalizeArgs([...base, '--anim', 'walk=w.glb'])).toThrow(/--anim: "walk" is not one of/);
  });

  test('rejects a malformed --rename', () => {
    expect(() => parseNormalizeArgs([...base, '--rename', 'Walking'])).toThrow(/--rename expects name=target, got "Walking"/);
  });

  test('rejects non-numeric numbers', () => {
    expect(() => parseNormalizeArgs([...base, '--rotate-y', 'left'])).toThrow(/--rotate-y expects a number, got "left"/);
  });

  test('rejects an unknown flag as a UsageError', () => {
    expect(() => parseNormalizeArgs([...base, '--frobnicate'])).toThrow(UsageError);
  });
});
