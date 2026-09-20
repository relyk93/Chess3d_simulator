// @vitest-environment node
import { Budget, BudgetError, knownCosts } from './budget';
import { defaultDesign } from './design';

describe('knownCosts', () => {
  test('uses Meshy documented prices and leaves image-to-3d out until it is known', () => {
    expect(knownCosts(defaultDesign())).toEqual({ 'text-to-image': 3, rigging: 5, animations: 3 });
  });

  test('uses the design image-to-3d cost when it is set', () => {
    const d = defaultDesign();
    d.credits.imageTo3d = 20;
    expect(knownCosts(d)['image-to-3d']).toBe(20);
  });

  test('prices each text-to-image model, and omits one it does not know', () => {
    const d = defaultDesign();
    d.textToImageModel = 'nano-banana-pro';
    expect(knownCosts(d)['text-to-image']).toBe(9);
    d.textToImageModel = 'mystery-model';
    expect(knownCosts(d)['text-to-image']).toBeUndefined();
  });
});

describe('Budget', () => {
  test('estimate returns a known cost and null for an unknown one', () => {
    const b = new Budget({ cap: 50, known: { rigging: 5 } });
    expect(b.estimate('rigging')).toBe(5);
    expect(b.estimate('image-to-3d')).toBeNull();
  });

  test('with no cap nothing is ever refused', () => {
    const b = new Budget({ cap: null, known: { rigging: 5 } });
    for (let i = 0; i < 100; i++) b.reserve('rigging');
  });

  test('refuses a task that would pass the cap, counting reservations that are still open', () => {
    const b = new Budget({ cap: 10, known: { rigging: 5 } });
    b.reserve('rigging');
    b.reserve('rigging');
    expect(() => b.reserve('rigging')).toThrow(BudgetError);
    expect(() => b.reserve('rigging')).toThrow(/would pass the 10 credit cap \(10 spent or reserved, 5 more needed\)/);
  });

  test('settle turns a reservation into real spend at the reported cost', () => {
    const b = new Budget({ cap: 10, known: { rigging: 5 } });
    const hold = b.reserve('rigging');
    b.settle('rigging', hold, 7);
    expect(b.spent).toBe(7);
    // 7 spent, so a 7-credit task no longer fits under the cap of 10 with another 7
    expect(() => b.reserve('rigging')).toThrow(/7 spent or reserved, 7 more needed/);
  });

  test('settle learns the real cost of a kind that was unknown', () => {
    const b = new Budget({ cap: 100, known: {} });
    const hold = b.reserve('image-to-3d');
    expect(hold).toBe(0);
    b.settle('image-to-3d', hold, 22);
    expect(b.estimate('image-to-3d')).toBe(22);
    expect(b.spent).toBe(22);
  });

  test('a reported cost overrides a documented one, in case Meshy changed its prices', () => {
    const b = new Budget({ cap: null, known: { rigging: 5 } });
    b.settle('rigging', b.reserve('rigging'), 8);
    expect(b.estimate('rigging')).toBe(8);
  });

  test('settle without a reported cost charges the estimate', () => {
    const b = new Budget({ cap: null, known: { animations: 3 } });
    b.settle('animations', b.reserve('animations'), null);
    expect(b.spent).toBe(3);
  });

  test('release frees a reservation without spending or learning', () => {
    const b = new Budget({ cap: 5, known: { rigging: 5 } });
    const hold = b.reserve('rigging');
    b.release(hold);
    expect(b.spent).toBe(0);
    expect(() => b.reserve('rigging')).not.toThrow();
  });

  test('observe learns a cost without spending it, for a task an earlier run paid for', () => {
    const b = new Budget({ cap: 100, known: {} });
    b.observe('image-to-3d', 22);
    expect(b.estimate('image-to-3d')).toBe(22);
    expect(b.spent).toBe(0);
  });

  test('capped says whether a limit is being enforced', () => {
    expect(new Budget({ cap: 5 }).capped).toBe(true);
    expect(new Budget({ cap: null }).capped).toBe(false);
  });

  test('isKnown says whether a cost can be estimated before spending', () => {
    const b = new Budget({ cap: 5, known: { rigging: 5 } });
    expect(b.isKnown('rigging')).toBe(true);
    expect(b.isKnown('image-to-3d')).toBe(false);
  });
});
