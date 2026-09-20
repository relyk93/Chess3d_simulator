import { PARTICLE_STYLES, ParticleSystem } from './particles';

/** Deterministic pseudo-random sequence for repeatable tests. */
function seeded(): () => number {
  let a = 1234567;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

const origin = { x: 1, y: 0.5, z: -2 };

test('emit activates the style count of particles at the impact point', () => {
  const p = new ParticleSystem(200, seeded());
  p.emit(origin, 'fire');
  expect(p.activeCount).toBe(PARTICLE_STYLES.fire.count);
  expect(Array.from(p.positions.slice(0, 3))).toEqual([1, 0.5, -2]);
  PARTICLE_STYLES.fire.color.forEach((c, k) => expect(p.colors[k]).toBeCloseTo(c, 5));
});

test('every effect in the fixed enum has a style', () => {
  expect(Object.keys(PARTICLE_STYLES).sort()).toEqual(['fire', 'ice', 'light', 'shadow', 'sparks']);
});

test('particles move, fade toward black, and expire after their life', () => {
  const p = new ParticleSystem(200, seeded());
  p.emit(origin, 'sparks');
  const startY = p.positions[1]!;
  p.update(0.1);
  expect(p.positions[1]).not.toBe(startY);
  expect(p.colors[0]!).toBeLessThan(PARTICLE_STYLES.sparks.color[0]);
  expect(p.colors[0]!).toBeGreaterThan(0);
  p.update(2);
  expect(p.activeCount).toBe(0);
  expect(Array.from(p.colors.slice(0, 3))).toEqual([0, 0, 0]);
});

test('sparks rise at first, then gravity pulls them back below the impact height', () => {
  // rand fixed at 0.5: no horizontal or vertical burst component, so vy starts at the style's lift (1.0).
  const p = new ParticleSystem(200, () => 0.5);
  p.emit(origin, 'sparks');
  p.update(0.1);
  expect(p.positions[1]!).toBeGreaterThan(origin.y);
  for (let t = 0.1; t < 0.55; t += 0.05) p.update(0.05);
  expect(p.positions[1]!).toBeLessThan(origin.y);
});

test('a full pool overwrites the oldest particles instead of growing', () => {
  const p = new ParticleSystem(100, seeded());
  p.emit(origin, 'fire');
  p.emit(origin, 'fire');
  expect(p.activeCount).toBe(100);
  expect(p.positions.length).toBe(300);
});

test('update on an empty pool does nothing', () => {
  const p = new ParticleSystem(10, seeded());
  expect(() => p.update(0.016)).not.toThrow();
  expect(p.activeCount).toBe(0);
});
