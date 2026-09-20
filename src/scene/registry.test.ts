import { createSceneRegistry } from './registry';
import type { PieceHandle } from '../sequencer/types';

const recordingPiece = (log: string[], name: string): PieceHandle => ({
  play: () => log.push(`${name}.play`),
  moveTo: () => log.push(`${name}.moveTo`),
  fadeOut: () => log.push(`${name}.fadeOut`),
  pulse: () => log.push(`${name}.pulse`),
  hold: () => log.push(`${name}.hold`),
  finish: () => log.push(`${name}.finish`),
  reset: () => log.push(`${name}.reset`),
  snapshot: () => ({ x: 1, z: 2, visible: true }),
});

test('unknown pieces and unmounted camera, effects and audio are harmless no-ops', () => {
  const { handles } = createSceneRegistry();
  expect(() => {
    handles.piece('nope').moveTo('e4', 100);
    handles.piece('nope').finish();
    handles.camera.flyTo({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, 100);
    handles.camera.finish();
    handles.effects.burst({ x: 0, y: 0, z: 0 }, 'fire');
    handles.audio.play('hit');
    handles.reset();
  }).not.toThrow();
});

test('registered handles receive calls through the stable handles object', () => {
  const reg = createSceneRegistry();
  const log: string[] = [];
  reg.setPiece('a', recordingPiece(log, 'a'));
  reg.handles.piece('a').hold();
  reg.handles.piece('a').moveTo('e4', 350);
  expect(log).toEqual(['a.hold', 'a.moveTo']);
  expect(reg.pieceIds()).toEqual(['a']);
});

test('camera, effects and audio delegate to whatever is currently registered', () => {
  const reg = createSceneRegistry();
  const log: string[] = [];
  const cam = { flyTo: () => log.push('fly'), shake: () => {}, restore: () => log.push('restore'), orbit: () => {}, finish: () => log.push('cam.finish'), reset: () => log.push('cam.reset') };
  const off = reg.setCamera(cam);
  reg.setEffects({ burst: (_p, e) => log.push(`burst:${e}`) });
  reg.setAudio({ play: (s) => log.push(`audio:${s}`) });
  reg.handles.camera.flyTo({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, 1);
  reg.handles.camera.restore(1);
  reg.handles.effects.burst({ x: 0, y: 0, z: 0 }, 'ice');
  reg.handles.audio.play('die');
  off();
  reg.handles.camera.finish();
  expect(log).toEqual(['fly', 'restore', 'burst:ice', 'audio:die']);
});

test('reset restores every registered piece and the camera', () => {
  const reg = createSceneRegistry();
  const log: string[] = [];
  reg.setPiece('a', recordingPiece(log, 'a'));
  reg.setPiece('b', recordingPiece(log, 'b'));
  reg.setCamera({ flyTo() {}, shake() {}, restore() {}, orbit() {}, finish() {}, reset: () => log.push('cam.reset') });
  reg.handles.reset();
  expect(log.sort()).toEqual(['a.reset', 'b.reset', 'cam.reset']);
});

test('an unregister function only removes its own handle, so a remount is not clobbered', () => {
  const reg = createSceneRegistry();
  const log: string[] = [];
  const offOld = reg.setPiece('a', recordingPiece(log, 'old'));
  reg.setPiece('a', recordingPiece(log, 'new'));
  offOld();
  reg.handles.piece('a').hold();
  expect(log).toEqual(['new.hold']);
});

test('snapshotAll reports what every registered piece is showing', () => {
  const reg = createSceneRegistry();
  reg.setPiece('a', recordingPiece([], 'a'));
  reg.setPiece('b', recordingPiece([], 'b'));
  expect(reg.snapshotAll()).toEqual({ a: { x: 1, z: 2, visible: true }, b: { x: 1, z: 2, visible: true } });
});
