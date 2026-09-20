import type { ClipName, Point2 } from '../sequencer/types';
import { clamp01, easeInOutCubic, easeInQuad, easeOutCubic, lerp } from './easing';

export interface MotionOutput {
  /** World position of the piece's base, including any rigid-clip offset. */
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
  /** 0..1 red flash from the rigid `hit` clip. */
  flash: number;
  /** 0..1 emissive pulse for check. */
  pulse: number;
}

export type MotionEvent = 'shatter';

/** Rigid fallback clips (spec section 5.3). Durations in ms. */
export const RIGID_DURATION: Record<Exclude<ClipName, 'idle'>, number> = { attack: 600, hit: 250, die: 500, victory: 400 };
const IDLE_AMPLITUDE = 0.002;
const IDLE_PERIOD_MS = 3000;
const LUNGE = 0.4;
const RECOIL = 0.12;
const RECOIL_MS = 80;
const HOP = 0.25;

interface Timed { t: number; duration: number }

/**
 * Pure per-piece animation state: position tweens, fades, pulses and the rigid fallback clips.
 * No three.js; the scene reads `output()` every frame and applies it.
 */
export class PieceMotion {
  private pos: Point2;
  private slide: (Timed & { from: Point2; to: Point2 }) | null = null;
  private aim: Point2;
  private fade: Timed | null = null;
  private opacity = 1;
  private rigid: (Timed & { clip: Exclude<ClipName, 'idle'> }) | null = null;
  private dead = false;
  private pulseAnim: Timed | null = null;
  private idleMs = 0;
  private events: MotionEvent[] = [];
  bob = true;

  /** `forward` is the unit world vector toward the opponent; rigid clips lunge and recoil along it. */
  constructor(start: Point2, forward: Point2) {
    this.pos = { ...start };
    this.aim = { ...forward };
  }

  snapTo(p: Point2): void {
    this.slide = null;
    this.pos = { ...p };
  }

  moveTo(to: Point2, ms: number): void {
    const from = this.current();
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.05) this.aim = { x: dx / len, z: dz / len };
    if (ms <= 0) return this.snapTo(to);
    this.slide = { from, to: { ...to }, t: 0, duration: ms };
    this.pos = from;
  }

  fadeOut(ms: number): void {
    if (ms <= 0) {
      this.fade = null;
      this.opacity = 0;
      return;
    }
    this.fade = { t: 0, duration: ms };
  }

  /** Starts a rigid clip. `idle` is continuous and needs no start. */
  playRigid(clip: ClipName): void {
    if (clip === 'idle') return;
    this.rigid = { clip, t: 0, duration: RIGID_DURATION[clip] };
    if (clip === 'die') this.events.push('shatter');
  }

  pulse(ms: number): void {
    this.pulseAnim = ms > 0 ? { t: 0, duration: ms } : null;
  }

  /** Jump every running tween to its end. A finished `die` leaves the piece dead until `reset`. */
  finish(): void {
    if (this.slide) {
      this.pos = { ...this.slide.to };
      this.slide = null;
    }
    if (this.fade) {
      this.opacity = 0;
      this.fade = null;
    }
    if (this.rigid?.clip === 'die') this.dead = true;
    this.rigid = null;
    this.pulseAnim = null;
  }

  /** Back to a clean, visible piece standing on `at`. */
  reset(at: Point2): void {
    this.slide = null;
    this.fade = null;
    this.rigid = null;
    this.pulseAnim = null;
    this.opacity = 1;
    this.dead = false;
    this.pos = { ...at };
  }

  current(): Point2 {
    if (!this.slide) return { ...this.pos };
    const u = easeInOutCubic(clamp01(this.slide.t / this.slide.duration));
    return { x: lerp(this.slide.from.x, this.slide.to.x, u), z: lerp(this.slide.from.z, this.slide.to.z, u) };
  }

  update(dtMs: number): void {
    this.idleMs += dtMs;
    if (this.slide) {
      this.slide.t += dtMs;
      if (this.slide.t >= this.slide.duration) {
        this.pos = { ...this.slide.to };
        this.slide = null;
      }
    }
    if (this.fade) {
      this.fade.t += dtMs;
      if (this.fade.t >= this.fade.duration) {
        this.opacity = 0;
        this.fade = null;
      }
    }
    if (this.rigid) {
      this.rigid.t += dtMs;
      if (this.rigid.t >= this.rigid.duration) {
        if (this.rigid.clip === 'die') this.dead = true;
        this.rigid = null;
      }
    }
    if (this.pulseAnim) {
      this.pulseAnim.t += dtMs;
      if (this.pulseAnim.t >= this.pulseAnim.duration) this.pulseAnim = null;
    }
  }

  takeEvents(): MotionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get busy(): boolean {
    return this.slide !== null || this.fade !== null || this.rigid !== null || this.pulseAnim !== null;
  }

  output(): MotionOutput {
    const p = this.current();
    let ox = 0;
    let oy = this.bob ? IDLE_AMPLITUDE * Math.sin((2 * Math.PI * this.idleMs) / IDLE_PERIOD_MS) : 0;
    let oz = 0;
    let scale = this.dead ? 0 : 1;
    let flash = 0;
    const r = this.rigid;
    if (r) {
      const u = clamp01(r.t / r.duration);
      if (r.clip === 'attack') {
        const l = LUNGE * (u < 0.5 ? easeOutCubic(u * 2) : 1 - easeOutCubic((u - 0.5) * 2));
        ox = this.aim.x * l;
        oz = this.aim.z * l;
      } else if (r.clip === 'hit') {
        const rec = r.t < RECOIL_MS ? RECOIL * easeOutCubic(r.t / RECOIL_MS) : RECOIL * (1 - easeInOutCubic(clamp01((r.t - RECOIL_MS) / (r.duration - RECOIL_MS))));
        ox = -this.aim.x * rec;
        oz = -this.aim.z * rec;
        flash = 1 - u;
      } else if (r.clip === 'die') {
        scale = 1 - easeInQuad(u);
      } else if (r.clip === 'victory') {
        oy += HOP * Math.sin(Math.PI * u);
      }
    }
    const opacity = this.fade ? 1 - clamp01(this.fade.t / this.fade.duration) : this.opacity;
    const pulse = this.pulseAnim ? 0.5 * (1 - Math.cos(4 * Math.PI * clamp01(this.pulseAnim.t / this.pulseAnim.duration))) : 0;
    return { x: p.x + ox, y: oy, z: p.z + oz, scale, opacity, flash, pulse };
  }
}
