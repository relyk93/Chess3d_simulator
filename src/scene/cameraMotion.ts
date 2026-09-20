import type { CameraPose, Vec3 } from '../sequencer/types';
import { clamp01, easeInOutCubic, lerp } from './easing';

const copyPose = (p: CameraPose): CameraPose => ({ position: { ...p.position }, target: { ...p.target } });
const lerpVec = (a: Vec3, b: Vec3, u: number): Vec3 => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });

type Main =
  | { kind: 'fly'; from: CameraPose; to: CameraPose; t: number; duration: number; clearSavedOnEnd: boolean }
  | { kind: 'orbit'; t: number; duration: number; radius: number; angle0: number; height: number; turns: number; target: Vec3 };

/**
 * Pure camera animation state. `flyTo`/`restore`/`orbit` run one main motion at a time; `shake` overlays a
 * decaying offset. The scene copies `pose` (plus `shakeOffset`) onto the real camera every frame while `busy`.
 */
export class CameraMotion {
  private current: CameraPose;
  private saved: CameraPose | null = null;
  private main: Main | null = null;
  private shakeAnim: { t: number; duration: number; intensity: number } | null = null;

  constructor(initial: CameraPose) {
    this.current = copyPose(initial);
  }

  /** Adopt the real camera's pose (the user may have orbited). Ignored while a motion is running. */
  syncFrom(pose: CameraPose): void {
    if (!this.busy) this.current = copyPose(pose);
  }

  get pose(): CameraPose {
    return this.current;
  }

  get busy(): boolean {
    return this.main !== null || this.shakeAnim !== null;
  }

  get shakeOffset(): Vec3 {
    const s = this.shakeAnim;
    if (!s) return { x: 0, y: 0, z: 0 };
    const decay = 1 - clamp01(s.t / s.duration);
    const k = s.intensity * decay;
    return { x: Math.sin(s.t * 0.12) * k, y: Math.cos(s.t * 0.17) * k * 0.6, z: Math.sin(s.t * 0.09 + 1) * k };
  }

  flyTo(pose: CameraPose, ms: number): void {
    this.saved ??= copyPose(this.current);
    this.startFly(pose, ms, false);
  }

  /** Returns to the view remembered by the first `flyTo`. A no-op if there is none. */
  restore(ms: number): void {
    if (!this.saved) return;
    this.startFly(this.saved, ms, true);
  }

  orbit(ms: number, turns: number): void {
    const { position, target } = this.current;
    const dx = position.x - target.x;
    const dz = position.z - target.z;
    this.main = { kind: 'orbit', t: 0, duration: Math.max(1, ms), radius: Math.hypot(dx, dz), angle0: Math.atan2(dx, dz), height: position.y, turns, target: { ...target } };
    if (ms <= 0) this.finish();
  }

  shake(ms: number, intensity: number): void {
    this.shakeAnim = ms > 0 ? { t: 0, duration: ms, intensity } : null;
  }

  private startFly(to: CameraPose, ms: number, clearSavedOnEnd: boolean): void {
    this.main = { kind: 'fly', from: copyPose(this.current), to: copyPose(to), t: 0, duration: Math.max(1, ms), clearSavedOnEnd };
    if (ms <= 0) this.finish();
  }

  finish(): void {
    const m = this.main;
    if (m) {
      if (m.kind === 'fly') {
        this.current = copyPose(m.to);
        if (m.clearSavedOnEnd) this.saved = null;
      } else {
        this.applyOrbit(m, 1);
      }
      this.main = null;
    }
    this.shakeAnim = null;
  }

  /** Drop everything and forget the saved view; the next `syncFrom` adopts the real camera. */
  reset(): void {
    this.main = null;
    this.shakeAnim = null;
    this.saved = null;
  }

  update(dtMs: number): void {
    const m = this.main;
    if (m) {
      m.t += dtMs;
      const u = clamp01(m.t / m.duration);
      if (m.kind === 'fly') {
        const e = easeInOutCubic(u);
        this.current = { position: lerpVec(m.from.position, m.to.position, e), target: lerpVec(m.from.target, m.to.target, e) };
      } else {
        this.applyOrbit(m, u);
      }
      if (u >= 1) this.finish();
    }
    if (this.shakeAnim) {
      this.shakeAnim.t += dtMs;
      if (this.shakeAnim.t >= this.shakeAnim.duration) this.shakeAnim = null;
    }
  }

  private applyOrbit(m: Extract<Main, { kind: 'orbit' }>, u: number): void {
    const a = m.angle0 + Math.PI * 2 * m.turns * u;
    this.current = {
      position: { x: m.target.x + Math.sin(a) * m.radius, y: m.height, z: m.target.z + Math.cos(a) * m.radius },
      target: { ...m.target },
    };
  }
}
