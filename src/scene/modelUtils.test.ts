import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { applyLook, disposeModelMaterials, prepareModel } from './modelUtils';

function sampleModel() {
  const g = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#ffffff' }));
  mesh.name = 'body';
  g.add(mesh);
  return { g, mesh };
}

test('prepareModel clones geometry references but gives every instance its own material', () => {
  const { g, mesh } = sampleModel();
  const a = prepareModel(g);
  const b = prepareModel(g);
  const ma = (a.children[0] as Mesh).material as MeshStandardMaterial;
  const mb = (b.children[0] as Mesh).material as MeshStandardMaterial;
  expect(ma).not.toBe(mb);
  expect(ma).not.toBe(mesh.material);
  expect((a.children[0] as Mesh).geometry).toBe(mesh.geometry);
  expect((a.children[0] as Mesh).castShadow).toBe(true);
});

test('fading one instance leaves the others and the source untouched', () => {
  const { g, mesh } = sampleModel();
  const a = prepareModel(g);
  const b = prepareModel(g);
  applyLook(a, { opacity: 0.25, flash: 0, pulse: 0 });
  const ma = (a.children[0] as Mesh).material as MeshStandardMaterial;
  const mb = (b.children[0] as Mesh).material as MeshStandardMaterial;
  expect(ma.opacity).toBe(0.25);
  expect(ma.transparent).toBe(true);
  expect(mb.opacity).toBe(1);
  expect(mb.transparent).toBe(false);
  expect((mesh.material as MeshStandardMaterial).opacity).toBe(1);
});

test('flash tints the emissive red and pulse tints it warm; zero clears both', () => {
  const { g } = sampleModel();
  const a = prepareModel(g);
  const m = (a.children[0] as Mesh).material as MeshStandardMaterial;
  applyLook(a, { opacity: 1, flash: 1, pulse: 0 });
  expect(m.emissive.r).toBe(1);
  expect(m.emissive.g).toBeCloseTo(0.1);
  applyLook(a, { opacity: 1, flash: 0, pulse: 1 });
  expect(m.emissive.r).toBe(1);
  expect(m.emissive.g).toBeCloseTo(0.7);
  applyLook(a, { opacity: 1, flash: 0, pulse: 0 });
  expect([m.emissive.r, m.emissive.g, m.emissive.b]).toEqual([0, 0, 0]);
});

test('disposeModelMaterials disposes each instance material', () => {
  const { g } = sampleModel();
  const a = prepareModel(g);
  const m = (a.children[0] as Mesh).material as MeshStandardMaterial;
  const spy = vi.spyOn(m, 'dispose');
  disposeModelMaterials(a);
  expect(spy).toHaveBeenCalledTimes(1);
});
