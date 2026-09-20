export interface Geometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Surface of revolution around the Y axis. `profile` is [radius, y] from bottom to top. */
export function lathe(profile: [number, number][], segments = 28): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = profile.length;
  const height = Math.max(...profile.map((p) => p[1])) || 1;
  for (let i = 0; i < n; i++) {
    const prev = profile[Math.max(0, i - 1)]!;
    const next = profile[Math.min(n - 1, i + 1)]!;
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dr, dy) || 1;
    // Outward normal of a profile that runs bottom to top.
    const nr = dy / len;
    const ny = -dr / len;
    const [r, y] = profile[i]!;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(r * Math.sin(a), y, r * Math.cos(a));
      normals.push(nr * Math.sin(a), ny, nr * Math.cos(a));
      uvs.push(j / segments, y / height);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, normals, uvs, indices };
}

/** Axis-aligned box with flat faces, centered at (cx, cy, cz). */
export function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Geometry {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
  ];
  const g: Geometry = { positions: [], normals: [], uvs: [], indices: [] };
  for (const f of faces) {
    const base = g.positions.length / 3;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    f.v.forEach((v, i) => {
      g.positions.push(cx + v[0], cy + v[1], cz + v[2]);
      g.normals.push(...f.n);
      g.uvs.push(...uv[i]!);
    });
    g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return g;
}

export function merge(parts: Geometry[]): Geometry {
  const g: Geometry = { positions: [], normals: [], uvs: [], indices: [] };
  for (const p of parts) {
    const base = g.positions.length / 3;
    g.positions.push(...p.positions);
    g.normals.push(...p.normals);
    g.uvs.push(...p.uvs);
    g.indices.push(...p.indices.map((i) => i + base));
  }
  return g;
}
