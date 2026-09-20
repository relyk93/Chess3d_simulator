// @vitest-environment node
import { defaultDesign, DesignError } from './design';
import { buildPrompt } from './prompts';

describe('buildPrompt', () => {
  const d = defaultDesign();

  test('joins the style, the side look, the piece subject and the framing rules', () => {
    const prompt = buildPrompt(d, 'w-king');
    expect(prompt).toContain(d.style);
    expect(prompt).toContain(d.sideLook.w);
    expect(prompt).toContain(d.pieces['w-king']!.subject);
    expect(prompt).toMatch(/single figure.*full body.*centered.*front view.*plain neutral background.*round.*base/i);
  });

  test('the two sides get different looks and the same piece subject', () => {
    const white = buildPrompt(d, 'w-queen');
    const black = buildPrompt(d, 'b-queen');
    expect(white).not.toBe(black);
    expect(white).toMatch(/angel/i);
    expect(black).toMatch(/demon|infernal/i);
    expect(white).toContain(d.pieces['w-queen']!.subject);
    expect(black).toContain(d.pieces['b-queen']!.subject);
  });

  test('different pieces get different prompts', () => {
    expect(buildPrompt(d, 'w-king')).not.toBe(buildPrompt(d, 'w-pawn'));
  });

  test('the knight is a standing humanoid, because Meshy cannot rig a horse', () => {
    const prompt = buildPrompt(d, 'w-knight');
    expect(prompt).toMatch(/humanoid/i);
    expect(prompt).toMatch(/not a horse/i);
  });

  test('an unknown piece key is a DesignError', () => {
    expect(() => buildPrompt(d, 'w-dragon')).toThrow(DesignError);
  });
});
