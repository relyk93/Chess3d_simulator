const RATE = 22050;

/** Deterministic PRNG so regenerated packs are byte-identical. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => dv.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return out;
}

function render(seconds: number, fn: (t: number, rand: () => number) => number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const n = Math.floor(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, rand);
  return out;
}

/** Whoosh: noise with a bell-shaped envelope and a one-pole low-pass that opens up then closes. */
export function attackSound(): Uint8Array {
  let lp = 0;
  return encodeWav(render(0.5, (t, rand) => {
    const env = Math.sin(Math.PI * Math.min(1, t / 0.5)) ** 2;
    const k = 0.05 + 0.4 * env;
    lp += k * ((rand() * 2 - 1) - lp);
    return lp * env * 1.6;
  }, 1));
}

/** Thump: a falling sine plus a short noise click. */
export function hitSound(): Uint8Array {
  return encodeWav(render(0.3, (t, rand) => {
    const f = 50 + 90 * Math.exp(-t * 18);
    return (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 10) + (rand() * 2 - 1) * Math.exp(-t * 90) * 0.5) * 0.9;
  }, 2));
}

/** Fall: a downward sweep that fades out. */
export function dieSound(): Uint8Array {
  let phase = 0;
  return encodeWav(render(0.7, (t) => {
    phase += (2 * Math.PI * (420 * Math.exp(-t * 3.2) + 50)) / RATE;
    return Math.sin(phase) * Math.exp(-t * 3.5) * 0.7;
  }, 3));
}
