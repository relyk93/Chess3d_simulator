import { PieceMotion, RIGID_DURATION } from './pieceMotion';

const start = { x: 0, z: 0 };
const fwd = { x: 0, z: -1 };
const make = () => new PieceMotion(start, fwd);

test('starts visible and still, at the given position', () => {
  const m = make();
  expect(m.output()).toMatchObject({ x: 0, z: 0, scale: 1, opacity: 1, flash: 0, pulse: 0 });
  expect(m.busy).toBe(false);
});

test('moveTo eases from the current position to the target over the duration', () => {
  const m = make();
  m.moveTo({ x: 2, z: 0 }, 400);
  m.update(200);
  expect(m.output().x).toBeCloseTo(1, 5); // easeInOutCubic(0.5) = 0.5
  expect(m.busy).toBe(true);
  m.update(200);
  expect(m.output().x).toBeCloseTo(2, 5);
  expect(m.busy).toBe(false);
});

test('a second moveTo starts from where the first one currently is', () => {
  const m = make();
  m.moveTo({ x: 2, z: 0 }, 400);
  m.update(200);
  m.moveTo({ x: 1, z: 1 }, 100);
  expect(m.current().x).toBeCloseTo(1, 5);
  m.update(100);
  expect(m.current()).toEqual({ x: 1, z: 1 });
});

test('moveTo with zero duration snaps', () => {
  const m = make();
  m.moveTo({ x: 3, z: 3 }, 0);
  expect(m.current()).toEqual({ x: 3, z: 3 });
  expect(m.busy).toBe(false);
});

test('finish jumps a slide, a fade and a pulse to their ends', () => {
  const m = make();
  m.moveTo({ x: 2, z: 0 }, 400);
  m.fadeOut(700);
  m.pulse(1000);
  m.finish();
  expect(m.output()).toMatchObject({ x: 2, opacity: 0, pulse: 0 });
  expect(m.busy).toBe(false);
});

test('fadeOut lowers opacity linearly and stays at zero', () => {
  const m = make();
  m.fadeOut(400);
  m.update(100);
  expect(m.output().opacity).toBeCloseTo(0.75, 5);
  m.update(300);
  m.update(1000);
  expect(m.output().opacity).toBe(0);
});

test('reset restores a clean visible piece at the given position', () => {
  const m = make();
  m.fadeOut(0);
  m.playRigid('die');
  m.finish();
  expect(m.output()).toMatchObject({ opacity: 0, scale: 0 });
  m.reset({ x: 1, z: 1 });
  expect(m.output()).toMatchObject({ x: 1, z: 1, opacity: 1, scale: 1 });
});

describe('rigid fallback clips (spec 5.3)', () => {
  test('attack lunges 0.4 units toward the aim and back over 600 ms', () => {
    const m = make();
    m.bob = false;
    m.playRigid('attack');
    m.update(300);
    expect(m.output().z).toBeCloseTo(-0.4, 5);
    m.update(300);
    expect(m.output().z).toBeCloseTo(0, 5);
    expect(m.busy).toBe(false);
  });

  test('attack follows the direction of the latest move', () => {
    const m = make();
    m.bob = false;
    m.moveTo({ x: 1, z: 0 }, 0);
    m.playRigid('attack');
    m.update(300);
    expect(m.output().x - 1).toBeCloseTo(0.4, 5);
    expect(m.output().z).toBeCloseTo(0, 5);
  });

  test('hit recoils backward at 80 ms and flashes red, fading out', () => {
    const m = make();
    m.bob = false;
    m.playRigid('hit');
    m.update(80);
    const o = m.output();
    expect(o.z).toBeGreaterThan(0.1); // opposite the -z aim
    expect(o.flash).toBeGreaterThan(0.5);
    m.update(RIGID_DURATION.hit);
    expect(m.output()).toMatchObject({ z: 0, flash: 0 });
  });

  test('die shrinks to zero over 500 ms, emits one shatter event, and leaves the piece dead', () => {
    const m = make();
    m.playRigid('die');
    expect(m.takeEvents()).toEqual(['shatter']);
    expect(m.takeEvents()).toEqual([]);
    m.update(250);
    expect(m.output().scale).toBeCloseTo(1 - 0.25, 5);
    m.update(250);
    expect(m.output().scale).toBe(0);
    m.update(1000);
    expect(m.output().scale).toBe(0);
  });

  test('victory is one hop', () => {
    const m = make();
    m.bob = false;
    m.playRigid('victory');
    m.update(200);
    expect(m.output().y).toBeCloseTo(0.25, 5);
    m.update(200);
    expect(m.output().y).toBeCloseTo(0, 5);
  });

  test('idle bob is 2 mm with a 3 s period, and can be turned off', () => {
    const m = make();
    m.update(750);
    expect(m.output().y).toBeCloseTo(0.002, 5);
    m.bob = false;
    expect(m.output().y).toBe(0);
  });

  test('finish on a running die leaves the piece dead', () => {
    const m = make();
    m.playRigid('die');
    m.finish();
    expect(m.output().scale).toBe(0);
  });
});

test('check pulse rises and falls twice over its duration', () => {
  const m = make();
  m.pulse(1000);
  m.update(250);
  const peak1 = m.output().pulse;
  m.update(250);
  const trough = m.output().pulse;
  m.update(250);
  const peak2 = m.output().pulse;
  expect(peak1).toBeCloseTo(1, 5);
  expect(trough).toBeCloseTo(0, 5);
  expect(peak2).toBeCloseTo(1, 5);
  m.update(250);
  expect(m.output().pulse).toBe(0);
});
