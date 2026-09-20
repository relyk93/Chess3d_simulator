import type { PieceId, Square } from '../core/types';

export type ClipName = 'idle' | 'attack' | 'hit' | 'die' | 'victory';
export type ImpactEffect = 'light' | 'fire' | 'ice' | 'shadow' | 'sparks';
export type SoundName = 'attack' | 'hit' | 'die';

export interface Vec3 { x: number; y: number; z: number }
/** A point on the board plane, in world units. */
export interface Point2 { x: number; z: number }
export interface CameraPose { position: Vec3; target: Vec3 }

/**
 * One timed action. `at` is the start offset in ms from the start of the sequence and `duration` is how
 * long the action runs. Steps are plain data so sequences can be built, inspected and (later) overridden by packs.
 */
export type Step =
  | { at: number; duration: number; kind: 'camera.flyTo'; pose: CameraPose }
  | { at: number; duration: number; kind: 'camera.shake'; intensity: number }
  | { at: number; duration: number; kind: 'camera.restore' }
  | { at: number; duration: number; kind: 'camera.orbit'; turns: number }
  | { at: number; duration: number; kind: 'piece.play'; id: PieceId; clip: ClipName }
  | { at: number; duration: number; kind: 'piece.moveTo'; id: PieceId; to: Square | Point2 }
  | { at: number; duration: number; kind: 'piece.fadeOut'; id: PieceId }
  | { at: number; duration: number; kind: 'piece.pulse'; id: PieceId }
  | { at: number; duration: 0; kind: 'effects.burst'; position: Vec3; effect: ImpactEffect }
  | { at: number; duration: 0; kind: 'audio.play'; sound: SoundName };

export interface Sequence {
  steps: Step[];
}

/** What a piece is currently showing. Used by tests and dev tools to check the scene against the controller. */
export interface PieceSnapshot {
  x: number;
  z: number;
  visible: boolean;
}

export interface PieceHandle {
  /** Plays a clip from the model if it has one, otherwise the rigid fallback (spec 5.3). */
  play(clip: ClipName): void;
  moveTo(to: Square | Point2, durationMs: number): void;
  fadeOut(durationMs: number): void;
  pulse(durationMs: number): void;
  /** The controller state has already advanced; keep showing the pre-move pose until `finish()`. */
  hold(): void;
  /** Snap every running tween to its end, release the hold, and adopt the controller's square and type. */
  finish(): void;
  /** Full restore to what the controller state says: visible or not, square, type, no clip. */
  reset(): void;
  snapshot(): PieceSnapshot;
}

export interface CameraHandle {
  /** Remembers the current orbit view the first time it is called, so `restore` can return to it. */
  flyTo(pose: CameraPose, durationMs: number): void;
  shake(durationMs: number, intensity: number): void;
  restore(durationMs: number): void;
  orbit(durationMs: number, turns: number): void;
  finish(): void;
  reset(): void;
}

export interface EffectsHandle {
  burst(position: Vec3, effect: ImpactEffect): void;
}

export interface AudioHandle {
  play(sound: SoundName): void;
}

export interface SequencerHandles {
  piece(id: PieceId): PieceHandle;
  camera: CameraHandle;
  effects: EffectsHandle;
  audio: AudioHandle;
  /** Restore every piece and the camera to what the controller state says. */
  reset(): void;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Sequencer {
  run(sequence: Sequence, handles: SequencerHandles): { done: Promise<void>; skip(): void };
}
