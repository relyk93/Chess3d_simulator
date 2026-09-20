import type { PieceId } from '../core/types';
import type { AudioHandle, CameraHandle, EffectsHandle, PieceHandle, PieceSnapshot, SequencerHandles } from '../sequencer/types';

const NOOP_PIECE: PieceHandle = { play() {}, moveTo() {}, fadeOut() {}, pulse() {}, hold() {}, finish() {}, reset() {}, snapshot: () => ({ x: 0, z: 0, visible: false }) };
const NOOP_CAMERA: CameraHandle = { flyTo() {}, shake() {}, restore() {}, orbit() {}, finish() {}, reset() {} };
const NOOP_EFFECTS: EffectsHandle = { burst() {} };
const NOOP_AUDIO: AudioHandle = { play() {} };

/**
 * The bridge between React (which owns the scene objects) and the plain-TypeScript sequencer (which
 * drives them). Scene components register their handles on mount and remove them on unmount; the
 * `handles` object the sequencer holds never changes identity and falls back to no-ops, so a piece or
 * camera that is not mounted yet can never break a sequence.
 */
export interface SceneRegistry {
  readonly handles: SequencerHandles;
  setPiece(id: PieceId, handle: PieceHandle): () => void;
  setCamera(handle: CameraHandle): () => void;
  setEffects(handle: EffectsHandle): () => void;
  setAudio(handle: AudioHandle): () => void;
  /** Dev and test introspection: which piece handles are registered, and what each one is showing. */
  pieceIds(): PieceId[];
  snapshotAll(): Record<PieceId, PieceSnapshot>;
}

export function createSceneRegistry(): SceneRegistry {
  const pieces = new Map<PieceId, PieceHandle>();
  let camera: CameraHandle | null = null;
  let effects: EffectsHandle | null = null;
  let audio: AudioHandle | null = null;

  const handles: SequencerHandles = {
    piece: (id) => pieces.get(id) ?? NOOP_PIECE,
    camera: {
      flyTo: (pose, ms) => (camera ?? NOOP_CAMERA).flyTo(pose, ms),
      shake: (ms, intensity) => (camera ?? NOOP_CAMERA).shake(ms, intensity),
      restore: (ms) => (camera ?? NOOP_CAMERA).restore(ms),
      orbit: (ms, turns) => (camera ?? NOOP_CAMERA).orbit(ms, turns),
      finish: () => (camera ?? NOOP_CAMERA).finish(),
      reset: () => (camera ?? NOOP_CAMERA).reset(),
    },
    effects: { burst: (position, effect) => (effects ?? NOOP_EFFECTS).burst(position, effect) },
    audio: { play: (sound) => (audio ?? NOOP_AUDIO).play(sound) },
    reset() {
      for (const p of pieces.values()) p.reset();
      (camera ?? NOOP_CAMERA).reset();
    },
  };

  // Each setter returns an unregister function that only removes its own handle, so a remount
  // that registers before the old cleanup runs is not clobbered.
  return {
    handles,
    setPiece(id, handle) {
      pieces.set(id, handle);
      return () => { if (pieces.get(id) === handle) pieces.delete(id); };
    },
    setCamera(handle) {
      camera = handle;
      return () => { if (camera === handle) camera = null; };
    },
    setEffects(handle) {
      effects = handle;
      return () => { if (effects === handle) effects = null; };
    },
    setAudio(handle) {
      audio = handle;
      return () => { if (audio === handle) audio = null; };
    },
    pieceIds: () => [...pieces.keys()],
    snapshotAll: () => Object.fromEntries([...pieces].map(([id, h]) => [id, h.snapshot()])),
  };
}
