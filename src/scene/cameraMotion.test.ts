import { CameraMotion } from './cameraMotion';

const home = { position: { x: 0, y: 7, z: 7.5 }, target: { x: 0, y: 0, z: 0 } };
const shot = { position: { x: 2, y: 1.4, z: 3 }, target: { x: 0.5, y: 0.45, z: 0 } };

test('flyTo eases to the pose and reports busy until it lands', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 900);
  expect(c.busy).toBe(true);
  c.update(450);
  expect(c.pose.position.x).toBeCloseTo(1, 5);
  c.update(450);
  expect(c.pose).toEqual(shot);
  expect(c.busy).toBe(false);
});

test('restore returns to the view remembered by the first flyTo, even after several flights', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 100);
  c.update(100);
  c.flyTo({ position: { x: 9, y: 9, z: 9 }, target: { x: 1, y: 1, z: 1 } }, 100);
  c.update(100);
  c.restore(100);
  c.update(100);
  expect(c.pose).toEqual(home);
});

test('restore with nothing saved is a no-op', () => {
  const c = new CameraMotion(home);
  c.restore(500);
  expect(c.busy).toBe(false);
  expect(c.pose).toEqual(home);
});

test('after a restore the saved view is forgotten, so the next flyTo saves the new current view', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 0);
  c.restore(0);
  const moved = { position: { x: 5, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 } };
  c.syncFrom(moved);
  c.flyTo(shot, 0);
  c.restore(0);
  expect(c.pose).toEqual(moved);
});

test('finish jumps a running flight to its end and clears the shake', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 900);
  c.shake(250, 0.1);
  c.finish();
  expect(c.pose).toEqual(shot);
  expect(c.busy).toBe(false);
  expect(c.shakeOffset).toEqual({ x: 0, y: 0, z: 0 });
});

test('finish on a running restore lands on the saved view', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 0);
  c.restore(900);
  c.update(100);
  c.finish();
  expect(c.pose).toEqual(home);
});

test('shake decays to nothing over its duration', () => {
  const c = new CameraMotion(home);
  c.shake(250, 0.1);
  c.update(10);
  const early = Math.hypot(c.shakeOffset.x, c.shakeOffset.y, c.shakeOffset.z);
  expect(early).toBeGreaterThan(0);
  c.update(240);
  expect(c.shakeOffset).toEqual({ x: 0, y: 0, z: 0 });
  expect(c.busy).toBe(false);
});

test('orbit keeps radius and height and ends where it started after one full turn', () => {
  const c = new CameraMotion(home);
  const radius = Math.hypot(home.position.x, home.position.z);
  c.orbit(6000, 1);
  c.update(1500);
  const p = c.pose.position;
  expect(Math.hypot(p.x, p.z)).toBeCloseTo(radius, 5);
  expect(p.y).toBe(7);
  expect(p.x).not.toBeCloseTo(home.position.x, 1);
  c.update(4500);
  expect(c.pose.position.x).toBeCloseTo(home.position.x, 5);
  expect(c.pose.position.z).toBeCloseTo(home.position.z, 5);
  expect(c.busy).toBe(false);
});

test('syncFrom adopts the real camera only while idle', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 900);
  c.syncFrom({ position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } });
  c.update(900);
  expect(c.pose).toEqual(shot);
});

test('reset forgets the saved view and any running motion', () => {
  const c = new CameraMotion(home);
  c.flyTo(shot, 900);
  c.reset();
  expect(c.busy).toBe(false);
  c.restore(100);
  expect(c.busy).toBe(false);
});
