import { box, lathe, merge, type Geometry } from './shapes';

/** Every triangle's winding must agree with its vertex normals, or back-face culling hides the surface. */
function outwardFraction(g: Geometry): number {
  let good = 0;
  let total = 0;
  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
    const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!] as const;
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]] as const;
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]] as const;
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]] as const;
    if (Math.hypot(...n) < 1e-9) continue; // degenerate pole triangles
    const vn = [g.normals[a * 3]!, g.normals[a * 3 + 1]!, g.normals[a * 3 + 2]!] as const;
    total++;
    if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] > 0) good++;
  }
  return good / total;
}

test('lathe triangles wind outward', () => {
  const g = lathe([[0, 0], [0.3, 0], [0.3, 0.1], [0.15, 0.4], [0, 0.5]]);
  expect(outwardFraction(g)).toBe(1);
});

test('box triangles wind outward', () => {
  expect(outwardFraction(box(1, 2, 3, 2, 4, 6))).toBe(1);
});

test('merge offsets indices', () => {
  const g = merge([box(0, 0, 0, 1, 1, 1), box(5, 0, 0, 1, 1, 1)]);
  expect(g.positions.length / 3).toBe(48);
  expect(Math.max(...g.indices)).toBe(47);
});
