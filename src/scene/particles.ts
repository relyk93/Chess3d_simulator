import type { ImpactEffect, Vec3 } from '../sequencer/types';

export interface ParticleStyle {
  count: number;
  /** Start color; fades toward black (invisible under additive blending) over the particle's life. */
  color: [number, number, number];
  /** Initial speed in units per second. */
  speed: number;
  /** Extra upward speed added to every particle. */
  lift: number;
  /** Downward acceleration, units per second squared. */
  gravity: number;
  /** Lifetime in seconds. */
  life: number;
}

/** The fixed impact-effect enum from spec section 5.1. */
export const PARTICLE_STYLES: Record<ImpactEffect, ParticleStyle> = {
  light: { count: 70, color: [1.0, 0.92, 0.6], speed: 1.6, lift: 1.2, gravity: -0.6, life: 1.1 },
  fire: { count: 90, color: [1.0, 0.35, 0.06], speed: 1.8, lift: 1.6, gravity: -1.2, life: 0.9 },
  ice: { count: 70, color: [0.55, 0.85, 1.0], speed: 2.4, lift: 0.4, gravity: 2.2, life: 0.9 },
  shadow: { count: 60, color: [0.5, 0.2, 0.8], speed: 1.0, lift: 0.6, gravity: -0.3, life: 1.3 },
  sparks: { count: 50, color: [1.0, 0.85, 0.4], speed: 3.2, lift: 1.0, gravity: 5.0, life: 0.7 },
};

/**
 * Fixed-size CPU particle pool backing one THREE.Points object. `positions` and `colors` are the buffers the
 * scene uploads each frame. When the pool is full the oldest particles are overwritten.
 */
export class ParticleSystem {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly base: Float32Array;
  private readonly gravity: Float32Array;
  private cursor = 0;

  constructor(readonly max = 600, private readonly rand: () => number = Math.random) {
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.velocity = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max); // 0 = inactive
    this.base = new Float32Array(max * 3);
    this.gravity = new Float32Array(max);
  }

  emit(at: Vec3, effect: ImpactEffect): void {
    const s = PARTICLE_STYLES[effect];
    for (let n = 0; n < s.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      // Random direction on a sphere, scaled by a random fraction of the style speed.
      const theta = this.rand() * Math.PI * 2;
      const cosPhi = this.rand() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      const speed = s.speed * (0.4 + 0.6 * this.rand());
      this.positions.set([at.x, at.y, at.z], i * 3);
      this.velocity.set([Math.cos(theta) * sinPhi * speed, cosPhi * speed + s.lift, Math.sin(theta) * sinPhi * speed], i * 3);
      this.base.set(s.color, i * 3);
      this.colors.set(s.color, i * 3);
      this.age[i] = 0;
      this.life[i] = s.life * (0.7 + 0.3 * this.rand());
      this.gravity[i] = s.gravity;
    }
  }

  update(dtSec: number): void {
    for (let i = 0; i < this.max; i++) {
      const life = this.life[i]!;
      if (life === 0) continue;
      const age = this.age[i]! + dtSec;
      if (age >= life) {
        this.life[i] = 0;
        this.colors.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      this.age[i] = age;
      const o = i * 3;
      this.velocity[o + 1]! -= this.gravity[i]! * dtSec;
      this.positions[o]! += this.velocity[o]! * dtSec;
      this.positions[o + 1]! += this.velocity[o + 1]! * dtSec;
      this.positions[o + 2]! += this.velocity[o + 2]! * dtSec;
      const fade = 1 - age / life;
      this.colors[o] = this.base[o]! * fade;
      this.colors[o + 1] = this.base[o + 1]! * fade;
      this.colors[o + 2] = this.base[o + 2]! * fade;
    }
  }

  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.max; i++) if (this.life[i]! > 0) n++;
    return n;
  }
}
