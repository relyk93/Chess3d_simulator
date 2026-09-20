# Art Pipeline Tooling Implementation Plan (Plan 3 of 3)

> **Status: executed.** All nine tasks are built and verified. Running the real CLI and `gltf-transform validate` on files found two defects the unit tests missed (orphaned keyframe data, noisy library logging) and one usability gap (a stack trace for a missing input file). Those fixes are folded into the code below and listed under "As-Built Corrections".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn raw generated models into a valid, shippable set pack: `pnpm art normalize` fixes and validates one model, `pnpm art build-set` builds all twelve plus the manifest. Everything runs offline and calls no paid API.

**Architecture:** A small library under `tools/art/` built on glTF-Transform. Each concern is one pure module that takes a `Document` and either fixes it or throws a `NormalizeError` that names the piece: `inspect` (measure and reject), `transform` (scale, center, face), `clips` (rename, strip, validate, close the idle loop), `mergeClips` (copy clips from other files onto a rigged model), `textures` (shrink, enforce the 2 MB cap). `normalize` runs them in order; `buildSet` runs `normalize` over a source folder and writes the manifest last. Tests build fixture models in memory, so no binary fixtures are committed, and the output is cross-checked by three's own `GLTFLoader`, the same loader the app uses.

**Tech Stack:** As Plans 1 and 2, plus dev dependencies `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `@gltf-transform/cli` (4.5.0) and `sharp` (0.35.4).

**Spec:** `docs/superpowers/specs/2026-09-19-3d-chess-simulator-design.md` (sections 5, 5.2, 9, 11)

**Follow-on:** Plan 3b (live generation: concept images, Meshy clients, audio, board art). See "Deferred and Plan 3b". It needs decisions and API keys that this plan does not.

## What Was Verified Before Writing This Plan

The mechanics below were run in throwaway scripts against the installed versions, so the code in this plan is not speculative:

- `getBounds(scene)` sees through a wrapper node's rotation, scale and translation, including for a skinned model. A wrapper node named `normalized` centering a box at (1, 1.5, 5) and scaling it to height 1 gave min y = 0, max y = 1, x and z centered.
- `textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] })` shrinks 2048 and 1500 px textures to 1024, leaves a 512 px texture at 512 (no enlargement), and converts PNG to JPEG.
- `prune()` deletes a solid-color texture and folds it into a material factor (`pruneSolidTextures`, on by default), so fixture textures must not be a single color. Fixtures use a gradient.
- Copying an animation between two documents (clone the sampler's input and output accessors, retarget each channel by node name) works, and three's `GLTFLoader` reads the result with the clip and a skinned mesh intact.
- three's `GLTFLoader.parse` cannot decode embedded textures in Node (no `createImageBitmap`), so three-loader checks use texture-less fixtures, and texture behavior is checked at the glTF-Transform level with `sharp` metadata.

## Global Constraints

- Node 20 or newer (`engines.node` is `>=20.19.0`). Package manager is pnpm. If `pnpm` is not on the PATH, run it as `corepack pnpm`. TypeScript strict mode everywhere, including `tools/`.
- Every test file under `tools/` starts with `// @vitest-environment node` (the default environment is jsdom).
- Model conventions (spec 5.2): "Y-up, feet (or base) at y = 0, centered on x and z." "Faces +Z." Height: king 1.0 units, queen 0.9, bishop and knight 0.75, rook 0.7, pawn 0.55. "Under 2 MB per file with textures embedded, 2048 px maximum texture size." Animation clips, if present, "named exactly `idle`, `attack`, `hit`, `die`, `victory`. `idle` must loop cleanly."
- Black pieces are rotated 180 degrees by the engine, not baked into the model.
- `normalize` (spec 9) "must": reject non-Y-up or off-center models with a clear message; scale to the height table; rename clips from a mapping; "fail if a clip name outside the standard five remains"; "strip clips the manifest doesn't list."
- Version A rigs king, queen, bishop and knight on both sides (8 models). Pawns and rooks ship with no clips and use the rigid fallback (4 models).
- API keys live in `.env` and are never committed. Nothing in this plan reads one.
- Commit after every task with a conventional-commit message.

## Decisions Where the Spec Is Silent or Ambiguous

1. **Fix small errors, reject gross ones.** The spec says the normalizer rejects "off-center" models and also that its tests cover "pivot". Generated models have arbitrary origins, so the normalizer re-centers x and z and moves the base to y = 0 automatically. It rejects a model whose geometry sits more than 3 times its own height from the origin (a sign the export includes other objects) and any model that is much wider than tall (a sign it is Z-up or lying down: height under half of the larger of width and depth).
2. **Facing is an explicit input.** Facing cannot be detected reliably, so `rotateYDeg` is a per-model option. The engine still rotates black pieces itself.
3. **Clip mapping.** `rename` maps a source clip name to a standard name, or to `null` to delete it (a rig's walk and run cycles arrive in the rigged file and must be dropped). The "outside the standard five" check runs after renaming and before stripping, so a stray name is an error instead of being silently discarded. Then clips missing from `keep` are stripped, and a clip in `keep` that the model lacks is an error.
4. **Idle loop.** An `idle` clip whose last keyframe differs from its first is fixed by snapping the last keyframe to the first, with a warning. Cubic-spline channels are left alone with a warning.
5. **Textures become JPEG at 1024 px by default.** The spec's ceiling is 2048 px; 1024 keeps a piece well under 2 MB and is plenty at chess-piece screen size. `--max-texture` raises it up to 2048. Alpha is not preserved; generated base colors are opaque.
6. **No mesh compression yet.** Draco and meshopt would need a decoder path in the app's loader. Polycount is set at generation time instead (`target_polycount`).
7. **Names.** The spec lists `build-manifest.ts`. Ours is `buildSet.ts` because it also runs the normalizer over every piece and copies audio; the manifest is still written last, so a failed build never leaves a manifest pointing at missing files. Tools live in `tools/art/` beside Plan 2's `tools/dev-pack/`.
8. **The dev-pack generator is guarded, not deleted.** It still supplies the committed placeholder packs. `buildSet` stamps its manifest with `"generator": "art-pipeline"`, and `pnpm dev-packs` refuses to overwrite a pack carrying that stamp.
9. **Source folder.** Raw downloads and the build config live in `art-src/` (gitignored). The repository holds the tool, not the multi-megabyte raw art.

## File Structure

```
tools/art/
  spec.ts               height table, budgets, NormalizeError, pieceHeight()
  io.ts                 the one NodeIO (all extensions registered)
  generator.ts          ART_GENERATOR marker constant
  inspect.ts            theScene, measure, assertYUp, assertNotFarOff
  transform.ts          normalizeTransform (wrapper node)
  clips.ts              applyClips, closeLoop
  mergeClips.ts         mergeClips
  textures.ts           slim, assertSize
  normalize.ts          normalizeModel
  args.ts               parseNormalizeArgs, UsageError
  cli.ts                `pnpm art normalize | build-set`
  buildSet.ts           buildSet
  README.md             how to use it while curating
  testing/fixtures.ts   statueDoc, statueGlb, readGlb
  *.test.ts             one per module
tools/dev-pack/generate.ts   (modify) refuse to overwrite an art-pipeline pack
```

---

### Task 1: Constants, shared IO, and fixture models

**Files:**
- Create: `tools/art/spec.ts`, `tools/art/io.ts`, `tools/art/testing/fixtures.ts`
- Test: `tools/art/spec.test.ts`, `tools/art/testing/fixtures.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (dependencies)

**Interfaces:**
- Produces:
  - `spec.ts`: `HEIGHT_BY_NAME`, `type PieceName`, `RIGGED_NAMES`, `MAX_MODEL_BYTES = 2 * 1024 * 1024`, `MAX_TEXTURE_PX = 2048`, `DEFAULT_TEXTURE_PX = 1024`, `class NormalizeError extends Error` (constructor `(piece: string, problem: string)`, message `"<piece>: <problem>"`), `pieceHeight(piece: string): number`, and re-exports `ALL_PIECE_KEYS`, `CLIP_NAMES`, `type ClipName`.
  - `io.ts`: `io: NodeIO`.
  - `testing/fixtures.ts`: `interface StatueOptions { size?: [n,n,n]; center?: [n,n,n]; skinned?: boolean; clips?: string[]; openIdle?: boolean; texturePx?: number }`, `statueDoc(opts?): Promise<Document>`, `statueGlb(opts?): Promise<Uint8Array>`, `readGlb(bytes): Promise<Document>`.
  - A statue is a box (default 0.4 x 2 x 0.4, base on y = 0). With `skinned` it is bound to joints `root` (origin) and `tip` (one unit up). Each clip name animates the translation of `tip` (skinned) or the `body` node (not skinned). A clip whose name ends in `idle` (case-insensitive) is a closed three-key loop; `openIdle` makes it end on a different value.

- [ ] **Step 1: Confirm the dependencies are installed**

Already installed on this branch. To reproduce on a fresh checkout:

```bash
pnpm add -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions @gltf-transform/cli sharp
```

Run: `git diff --stat package.json` and check that all five appear under `devDependencies`.

- [ ] **Step 2: Write the failing constants test**

`tools/art/spec.test.ts`:

```ts
// @vitest-environment node
import { ALL_PIECE_KEYS, NormalizeError, pieceHeight } from './spec';

describe('art spec constants', () => {
  test('heights match spec 5.2', () => {
    expect(pieceHeight('w-king')).toBe(1.0);
    expect(pieceHeight('b-queen')).toBe(0.9);
    expect(pieceHeight('w-bishop')).toBe(0.75);
    expect(pieceHeight('b-knight')).toBe(0.75);
    expect(pieceHeight('w-rook')).toBe(0.7);
    expect(pieceHeight('b-pawn')).toBe(0.55);
  });

  test('every one of the 12 piece keys has a height', () => {
    expect(ALL_PIECE_KEYS).toHaveLength(12);
    for (const key of ALL_PIECE_KEYS) expect(pieceHeight(key)).toBeGreaterThan(0);
  });

  test('an unknown key is a NormalizeError that lists the valid keys', () => {
    expect(() => pieceHeight('w-dragon')).toThrow(NormalizeError);
    expect(() => pieceHeight('w-dragon')).toThrow(/w-dragon: unknown piece key.*w-king/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test tools/art/spec.test.ts`
Expected: FAIL, cannot find module `./spec`.

- [ ] **Step 4: Write `spec.ts` and `io.ts`**

`tools/art/spec.ts`:

```ts
import { ALL_PIECE_KEYS, CLIP_NAMES } from '../../src/packs/types';
import type { ClipName } from '../../src/sequencer/types';

export { ALL_PIECE_KEYS, CLIP_NAMES };
export type { ClipName };

/** Spec 5.2 height table, in world units. One square is 1.0 wide. */
export const HEIGHT_BY_NAME = { king: 1.0, queen: 0.9, bishop: 0.75, knight: 0.75, rook: 0.7, pawn: 0.55 } as const;
export type PieceName = keyof typeof HEIGHT_BY_NAME;

/** Spec section 9: the pieces Version A rigs. The rest ship with no clips. */
export const RIGGED_NAMES: readonly PieceName[] = ['king', 'queen', 'bishop', 'knight'];

export const MAX_MODEL_BYTES = 2 * 1024 * 1024;
export const MAX_TEXTURE_PX = 2048;
export const DEFAULT_TEXTURE_PX = 1024;

export class NormalizeError extends Error {
  constructor(piece: string, problem: string) {
    super(`${piece}: ${problem}`);
    this.name = 'NormalizeError';
  }
}

export function pieceHeight(piece: string): number {
  const name = piece.split('-')[1];
  if (name === undefined || !ALL_PIECE_KEYS.includes(piece)) {
    throw new NormalizeError(piece, `unknown piece key; expected one of ${ALL_PIECE_KEYS.join(', ')}`);
  }
  return HEIGHT_BY_NAME[name as PieceName];
}
```

`tools/art/io.ts`:

```ts
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/**
 * The one reader and writer for the pipeline, so extensions that generators emit are understood.
 * Documents it reads inherit its logger, which is set to warnings only: the library's per-step
 * progress lines would print a dozen times over during a whole-set build.
 */
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.WARN));
```

- [ ] **Step 5: Run the constants test and watch it pass**

Run: `pnpm test tools/art/spec.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing fixture test**

`tools/art/testing/fixtures.test.ts`:

```ts
// @vitest-environment node
import sharp from 'sharp';
import { getBounds } from '@gltf-transform/functions';
import type { Document } from '@gltf-transform/core';
import { readGlb, statueDoc, statueGlb } from './fixtures';

const bounds = (doc: Document) => getBounds(doc.getRoot().listScenes()[0]!);

describe('statue fixture', () => {
  test('the default statue is a 0.4 x 2 x 0.4 box standing on y = 0', async () => {
    const b = bounds(await statueDoc());
    expect(b.min[1]).toBeCloseTo(0, 5);
    expect(b.max[1]).toBeCloseTo(2, 5);
    expect(b.max[0] - b.min[0]).toBeCloseTo(0.4, 5);
  });

  test('size and center are honoured', async () => {
    const b = bounds(await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] }));
    expect(b.min).toEqual([2.5, 8, -3]);
    expect(b.max).toEqual([3.5, 12, -1]);
  });

  test('a skinned statue has a two-joint skin and its clips animate the tip joint', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['attack'] });
    const skin = doc.getRoot().listSkins()[0]!;
    expect(skin.listJoints().map((j) => j.getName())).toEqual(['root', 'tip']);
    const channel = doc.getRoot().listAnimations()[0]!.listChannels()[0]!;
    expect(channel.getTargetNode()?.getName()).toBe('tip');
  });

  test('an idle clip loops unless openIdle is set', async () => {
    const values = async (openIdle: boolean) => {
      const doc = await statueDoc({ clips: ['idle'], openIdle });
      const out = doc.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput()!.getArray()!;
      return [Array.from(out.slice(0, 3)), Array.from(out.slice(-3))];
    };
    const [firstClosed, lastClosed] = await values(false);
    expect(lastClosed).toEqual(firstClosed);
    const [firstOpen, lastOpen] = await values(true);
    expect(lastOpen).not.toEqual(firstOpen);
  });

  test('a texture is attached at the requested size', async () => {
    const doc = await statueDoc({ texturePx: 256 });
    const meta = await sharp(doc.getRoot().listTextures()[0]!.getImage()!).metadata();
    expect(meta.width).toBe(256);
  });

  test('a statue survives a glb round trip with its clips', async () => {
    const back = await readGlb(await statueGlb({ skinned: true, clips: ['idle', 'attack'] }));
    expect(back.getRoot().listAnimations().map((a) => a.getName()).sort()).toEqual(['attack', 'idle']);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm test tools/art/testing/fixtures.test.ts`
Expected: FAIL, cannot find module `./fixtures`.

- [ ] **Step 8: Write `fixtures.ts`**

`tools/art/testing/fixtures.ts`:

```ts
import sharp from 'sharp';
import { Document, type Accessor } from '@gltf-transform/core';
import { io } from '../io';

export interface StatueOptions {
  /** Box extents [x, y, z]. Default [0.4, 2, 0.4]. */
  size?: [number, number, number];
  /** Box center. Default [0, 1, 0], so the base sits on y = 0. */
  center?: [number, number, number];
  /** Bind the box to a two-joint skeleton: `root` at the origin and `tip` one unit up. */
  skinned?: boolean;
  /** Clips to author. A name ending in "idle" loops; the others are two-key moves. */
  clips?: string[];
  /** Make an idle clip end on a different value than it starts on. */
  openIdle?: boolean;
  /** Attach a non-solid base color texture of this many pixels square. */
  texturePx?: number;
}

const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
  [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
] as const;
const TRIANGLES = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];

/** A gradient, because `prune()` folds a solid-color texture into a material factor and removes it. */
function gradient(n: number): Buffer {
  const b = Buffer.alloc(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 3;
      b[i] = (x * 255) / n;
      b[i + 1] = (y * 255) / n;
      b[i + 2] = (x ^ y) & 255;
    }
  }
  return b;
}

export async function statueDoc(opts: StatueOptions = {}): Promise<Document> {
  const { size = [0.4, 2, 0.4], center = [0, 1, 0], skinned = false, clips = [], openIdle = false, texturePx } = opts;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (type: Parameters<Accessor['setType']>[0], array: Float32Array | Uint16Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const positions = new Float32Array(
    CORNERS.flatMap(([cx, cy, cz]) => [
      center[0] + (cx * size[0]) / 2,
      center[1] + (cy * size[1]) / 2,
      center[2] + (cz * size[2]) / 2,
    ]),
  );
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', positions))
    .setIndices(accessor('SCALAR', new Uint16Array(TRIANGLES)));

  if (texturePx) {
    const jpeg = await sharp(gradient(texturePx), { raw: { width: texturePx, height: texturePx, channels: 3 } }).jpeg().toBuffer();
    const texture = doc.createTexture('base').setMimeType('image/jpeg').setImage(new Uint8Array(jpeg));
    prim.setMaterial(doc.createMaterial('paint').setBaseColorTexture(texture));
    prim.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1])));
  }

  const scene = doc.createScene('scene');
  const body = doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim));
  let animated = body;

  if (skinned) {
    const joints = new Uint16Array(32);
    const weights = new Float32Array(32);
    CORNERS.forEach(([, cy], v) => {
      joints[v * 4] = cy > 0 ? 1 : 0;
      weights[v * 4] = 1;
    });
    prim.setAttribute('JOINTS_0', accessor('VEC4', joints)).setAttribute('WEIGHTS_0', accessor('VEC4', weights));
    const root = doc.createNode('root');
    const tip = doc.createNode('tip').setTranslation([0, 1, 0]);
    root.addChild(tip);
    const inverseBind = new Float32Array(32);
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1], 16);
    body.setSkin(
      doc.createSkin('skin').addJoint(root).addJoint(tip).setSkeleton(root).setInverseBindMatrices(accessor('MAT4', inverseBind)),
    );
    scene.addChild(root);
    animated = tip;
  }
  scene.addChild(body);

  for (const name of clips) {
    const base = animated.getTranslation();
    const lift = (dy: number): number[] => [base[0], base[1] + dy, base[2]];
    const loops = /idle$/i.test(name);
    const times = loops ? [0, 0.5, 1] : [0, 1];
    const values = loops ? [...lift(0), ...lift(0.1), ...lift(openIdle ? 0.05 : 0)] : [...lift(0), ...lift(0.1)];
    const sampler = doc
      .createAnimationSampler()
      .setInput(accessor('SCALAR', new Float32Array(times)))
      .setOutput(accessor('VEC3', new Float32Array(values)))
      .setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(animated).setTargetPath('translation').setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  }
  return doc;
}

export async function statueGlb(opts: StatueOptions = {}): Promise<Uint8Array> {
  return io.writeBinary(await statueDoc(opts));
}

export function readGlb(bytes: Uint8Array): Promise<Document> {
  return io.readBinary(bytes);
}
```

- [ ] **Step 9: Run both tests and typecheck**

Run: `pnpm test tools/art && pnpm typecheck`
Expected: PASS (9 tests), typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tools/art
git commit -m "feat(tools): add art pipeline constants, shared glTF io and test fixtures"
```

---

### Task 2: Measure a model and reject bad ones

**Files:**
- Create: `tools/art/inspect.ts`
- Test: `tools/art/inspect.test.ts`

**Interfaces:**
- Consumes: `NormalizeError` from `spec.ts`; `statueDoc` from `testing/fixtures.ts`.
- Produces:
  - `type Vec3 = [number, number, number]`
  - `interface Measure { min: Vec3; max: Vec3; size: Vec3; center: Vec3 }`
  - `theScene(doc: Document, piece: string): Scene` (throws unless exactly one scene)
  - `measure(scene: Scene, piece: string): Measure` (throws on empty or flat bounds)
  - `assertYUp(m: Measure, piece: string): void`
  - `assertNotFarOff(m: Measure, piece: string): void`

- [ ] **Step 1: Write the failing test**

`tools/art/inspect.test.ts`:

```ts
// @vitest-environment node
import { Document } from '@gltf-transform/core';
import { assertNotFarOff, assertYUp, measure, theScene } from './inspect';
import { statueDoc } from './testing/fixtures';

const sceneOf = (doc: Document) => theScene(doc, 'w-king');

describe('measure', () => {
  test('reports min, max, size and center in world space', async () => {
    const m = measure(sceneOf(await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] })), 'w-king');
    expect(m.size).toEqual([1, 4, 2]);
    expect(m.center).toEqual([3, 10, -2]);
    expect(m.min[1]).toBe(8);
  });

  test('rejects a scene with no geometry', () => {
    const doc = new Document();
    doc.createScene('empty');
    expect(() => measure(sceneOf(doc), 'w-king')).toThrow(/w-king: .*empty or flat/);
  });

  test('theScene rejects a file with two scenes', () => {
    const doc = new Document();
    doc.createScene('a');
    doc.createScene('b');
    expect(() => theScene(doc, 'w-king')).toThrow(/w-king: expected exactly one scene, found 2/);
  });
});

describe('assertYUp', () => {
  test('accepts a piece that is taller than wide', async () => {
    const m = measure(sceneOf(await statueDoc()), 'w-king');
    expect(() => assertYUp(m, 'w-king')).not.toThrow();
  });

  test('accepts a squat pawn-shaped model', async () => {
    const m = measure(sceneOf(await statueDoc({ size: [1, 1.1, 1], center: [0, 0.55, 0] })), 'b-pawn');
    expect(() => assertYUp(m, 'b-pawn')).not.toThrow();
  });

  test('rejects a Z-up model with a message that says what to do', async () => {
    const m = measure(sceneOf(await statueDoc({ size: [0.4, 0.4, 2], center: [0, 0, 1] })), 'w-king');
    expect(() => assertYUp(m, 'w-king')).toThrow(/w-king: does not look Y-up.*re-export the model Y-up/);
  });
});

describe('assertNotFarOff', () => {
  test('accepts a modest offset, which the transform will fix', async () => {
    const m = measure(sceneOf(await statueDoc({ center: [1, 1, 0] })), 'w-king');
    expect(() => assertNotFarOff(m, 'w-king')).not.toThrow();
  });

  test('rejects geometry far from its origin', async () => {
    const m = measure(sceneOf(await statueDoc({ center: [10, 1, 0] })), 'w-king');
    expect(() => assertNotFarOff(m, 'w-king')).toThrow(/w-king: .*from the origin/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/inspect.test.ts`
Expected: FAIL, cannot find module `./inspect`.

- [ ] **Step 3: Implement `inspect.ts`**

```ts
import { getBounds } from '@gltf-transform/functions';
import type { Document, Scene } from '@gltf-transform/core';
import { NormalizeError } from './spec';

export type Vec3 = [number, number, number];

export interface Measure {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

const fmt = (n: number) => n.toFixed(2);

export function theScene(doc: Document, piece: string): Scene {
  const scenes = doc.getRoot().listScenes();
  if (scenes.length !== 1) throw new NormalizeError(piece, `expected exactly one scene, found ${scenes.length}`);
  return scenes[0]!;
}

export function measure(scene: Scene, piece: string): Measure {
  const { min, max } = getBounds(scene);
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!size.every((n) => Number.isFinite(n) && n > 0)) {
    throw new NormalizeError(piece, 'the model has an empty or flat bounding box; is there geometry in the scene?');
  }
  return {
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
    size,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/** A chess piece is taller than it is wide. Much wider than tall means Z-up or lying down. */
export function assertYUp(m: Measure, piece: string): void {
  const wide = Math.max(m.size[0], m.size[2]);
  if (m.size[1] < 0.5 * wide) {
    throw new NormalizeError(
      piece,
      `does not look Y-up: it is ${fmt(m.size[1])} tall (y) but ${fmt(wide)} wide (x or z). Chess pieces are taller than wide; re-export the model Y-up.`,
    );
  }
}

/** A small offset from the origin is fixed by the transform; a huge one means the export is wrong. */
export function assertNotFarOff(m: Measure, piece: string): void {
  const offset = Math.hypot(m.center[0], m.center[2]);
  if (offset > 3 * m.size[1]) {
    throw new NormalizeError(
      piece,
      `its geometry is ${fmt(offset)} units from the origin, over 3 times its own height. The export probably includes other objects. Small offsets are fixed automatically; this one is too large to trust.`,
    );
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tools/art/inspect.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/art/inspect.ts tools/art/inspect.test.ts
git commit -m "feat(tools): measure models and reject non-Y-up or far-off-center ones"
```

---

### Task 3: Scale, center, and face the model

**Files:**
- Create: `tools/art/transform.ts`
- Test: `tools/art/transform.test.ts`

**Interfaces:**
- Consumes: `measure`, `theScene` from `inspect.ts`.
- Produces:
  - `interface TransformOptions { targetHeight: number; rotateYDeg?: number }`
  - `interface TransformResult { scale: number; translation: [number, number, number] }`
  - `normalizeTransform(doc: Document, scene: Scene, piece: string, opts: TransformOptions): TransformResult`. It wraps the scene's children in one node named `normalized`. The wrapper is rotated first, the model is measured, then scale and translation are set so the base sits at y = 0, x and z are centered, and the height equals `targetHeight`.

- [ ] **Step 1: Write the failing test**

`tools/art/transform.test.ts`:

```ts
// @vitest-environment node
import type { Document } from '@gltf-transform/core';
import { measure, theScene } from './inspect';
import { statueDoc } from './testing/fixtures';
import { normalizeTransform } from './transform';

const sceneOf = (doc: Document) => theScene(doc, 'w-king');
const after = (doc: Document) => measure(sceneOf(doc), 'w-king');

describe('normalizeTransform', () => {
  test('scales to the target height, puts the base on y = 0 and centers x and z', async () => {
    const doc = await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] });
    const result = normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    const m = after(doc);
    expect(result.scale).toBeCloseTo(0.25, 6);
    expect(m.min[1]).toBeCloseTo(0, 5);
    expect(m.max[1]).toBeCloseTo(1, 5);
    expect(m.center[0]).toBeCloseTo(0, 5);
    expect(m.center[2]).toBeCloseTo(0, 5);
    expect(m.size[0]).toBeCloseTo(0.25, 5);
  });

  test('rotateYDeg turns the model before it is centered', async () => {
    const doc = await statueDoc({ size: [1, 2, 0.4], center: [0, 1, 0] });
    normalizeTransform(doc, sceneOf(doc), 'w-knight', { targetHeight: 0.75, rotateYDeg: 90 });
    const m = after(doc);
    expect(m.size[0]).toBeCloseTo(0.4 * 0.375, 4);
    expect(m.size[2]).toBeCloseTo(1 * 0.375, 4);
    expect(m.center[0]).toBeCloseTo(0, 4);
    expect(m.center[2]).toBeCloseTo(0, 4);
  });

  test('leaves one wrapper node under the scene', async () => {
    const doc = await statueDoc({ skinned: true });
    normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    expect(sceneOf(doc).listChildren().map((n) => n.getName())).toEqual(['normalized']);
  });

  test('works on a skinned model', async () => {
    const doc = await statueDoc({ skinned: true, size: [0.5, 3, 0.5], center: [1, 6, 0] });
    normalizeTransform(doc, sceneOf(doc), 'w-bishop', { targetHeight: 0.75 });
    const m = after(doc);
    expect(m.min[1]).toBeCloseTo(0, 5);
    expect(m.max[1]).toBeCloseTo(0.75, 5);
  });

  test('is idempotent: normalizing a normalized model changes nothing', async () => {
    const doc = await statueDoc({ size: [1, 4, 2], center: [3, 10, -2] });
    normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    const once = after(doc);
    const again = normalizeTransform(doc, sceneOf(doc), 'w-king', { targetHeight: 1 });
    const twice = after(doc);
    expect(again.scale).toBeCloseTo(1, 5);
    expect(twice.size[1]).toBeCloseTo(once.size[1], 5);
    expect(twice.min[1]).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/transform.test.ts`
Expected: FAIL, cannot find module `./transform`.

- [ ] **Step 3: Implement `transform.ts`**

```ts
import type { Document, Scene } from '@gltf-transform/core';
import { measure } from './inspect';

export interface TransformOptions {
  /** World height the model must end up with, in units. */
  targetHeight: number;
  /** Turn the model about Y before measuring, for exports that face -Z, +X or -X. */
  rotateYDeg?: number;
}

export interface TransformResult {
  scale: number;
  translation: [number, number, number];
}

/**
 * Wraps the scene's contents in one node named `normalized` and gives it the rotation, scale and
 * translation that put the model's base on y = 0, centered on x and z, at the target height.
 * One wrapper is safe for skinned and animated models, where editing every node is not.
 */
export function normalizeTransform(doc: Document, scene: Scene, piece: string, opts: TransformOptions): TransformResult {
  const wrapper = doc.createNode('normalized');
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);

  const half = ((opts.rotateYDeg ?? 0) * Math.PI) / 360;
  wrapper.setRotation([0, Math.sin(half), 0, Math.cos(half)]);

  const m = measure(scene, piece);
  const scale = opts.targetHeight / m.size[1];
  const translation: [number, number, number] = [-scale * m.center[0], -scale * m.min[1], -scale * m.center[2]];
  wrapper.setScale([scale, scale, scale]).setTranslation(translation);
  return { scale, translation };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tools/art/transform.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/art/transform.ts tools/art/transform.test.ts
git commit -m "feat(tools): scale, center and face models through a wrapper node"
```

---

### Task 4: Rename, strip, and validate clips; close the idle loop

**Files:**
- Create: `tools/art/clips.ts`
- Test: `tools/art/clips.test.ts`

**Interfaces:**
- Consumes: `CLIP_NAMES`, `ClipName`, `NormalizeError` from `spec.ts`; `statueDoc` from fixtures.
- Produces:
  - `interface ClipOptions { rename: Record<string, string | null>; keep: readonly ClipName[] }` (`null` deletes a clip)
  - `interface ClipReport { clips: ClipName[]; warnings: string[] }` (`clips` in `CLIP_NAMES` order)
  - `applyClips(doc: Document, piece: string, opts: ClipOptions): ClipReport`. Order: rename or delete, then error on names outside the standard five, then error on duplicates, then strip clips not in `keep`, then error on a `keep` clip the model lacks, then close the `idle` loop.
  - `closeLoop(anim: Animation): number` returns how many channels it snapped.

- [ ] **Step 1: Write the failing test**

`tools/art/clips.test.ts`:

```ts
// @vitest-environment node
import { applyClips, closeLoop } from './clips';
import { statueDoc } from './testing/fixtures';

const names = (doc: Awaited<ReturnType<typeof statueDoc>>) => doc.getRoot().listAnimations().map((a) => a.getName());

describe('applyClips', () => {
  test('renames from the map and reports clips in the standard order', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Armature|Attack', 'Armature|Idle'] });
    const report = applyClips(doc, 'w-king', {
      rename: { 'Armature|Attack': 'attack', 'Armature|Idle': 'idle' },
      keep: ['idle', 'attack'],
    });
    expect(report.clips).toEqual(['idle', 'attack']);
    expect(names(doc).sort()).toEqual(['attack', 'idle']);
  });

  test('a null mapping deletes a clip such as a rig walk cycle', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Walking', 'idle'] });
    const report = applyClips(doc, 'w-king', { rename: { Walking: null }, keep: ['idle'] });
    expect(report.clips).toEqual(['idle']);
    expect(names(doc)).toEqual(['idle']);
  });

  test('deleting a clip removes its channels and samplers too, so pruning can free the keyframes', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Walking', 'idle'] });
    const [walking, idle] = doc.getRoot().listAnimations();
    const walkChannel = walking!.listChannels()[0]!;
    const walkSampler = walkChannel.getSampler()!;
    const idleChannel = idle!.listChannels()[0]!;

    applyClips(doc, 'w-king', { rename: { Walking: null }, keep: ['idle'] });

    expect(walkChannel.isDisposed()).toBe(true);
    expect(walkSampler.isDisposed()).toBe(true);
    expect(idleChannel.isDisposed()).toBe(false);
  });

  test('a clip outside the standard five is an error that says how to fix it', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['Walking', 'idle'] });
    expect(() => applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] })).toThrow(
      /w-king: clips outside the standard five remain: "Walking".*--rename/,
    );
  });

  test('standard clips not listed in keep are stripped', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle', 'attack', 'hit'] });
    const report = applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] });
    expect(report.clips).toEqual(['idle']);
    expect(names(doc)).toEqual(['idle']);
  });

  test('an empty keep list strips every clip, for the rigid pieces', async () => {
    const doc = await statueDoc({ clips: ['idle', 'attack'] });
    expect(applyClips(doc, 'w-pawn', { rename: {}, keep: [] }).clips).toEqual([]);
    expect(names(doc)).toEqual([]);
  });

  test('a clip listed in keep but missing from the model is an error', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'] });
    expect(() => applyClips(doc, 'w-king', { rename: {}, keep: ['idle', 'die'] })).toThrow(
      /w-king: the manifest lists clips the model does not have: die/,
    );
  });

  test('two clips mapped to the same name are an error', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['a', 'b'] });
    expect(() => applyClips(doc, 'w-king', { rename: { a: 'attack', b: 'attack' }, keep: ['attack'] })).toThrow(
      /w-king: two clips are named "attack"/,
    );
  });

  test('an idle clip that does not loop is closed, with a warning', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'], openIdle: true });
    const report = applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] });
    expect(report.warnings).toEqual(['idle did not loop; snapped the last keyframe of 1 channel(s) to the first']);
    const out = doc.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput()!.getArray()!;
    expect(Array.from(out.slice(-3))).toEqual(Array.from(out.slice(0, 3)));
  });

  test('an idle clip that already loops gives no warning', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'] });
    expect(applyClips(doc, 'w-king', { rename: {}, keep: ['idle'] }).warnings).toEqual([]);
  });
});

describe('closeLoop', () => {
  test('returns 0 when the loop is already closed', async () => {
    const doc = await statueDoc({ skinned: true, clips: ['idle'] });
    expect(closeLoop(doc.getRoot().listAnimations()[0]!)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/clips.test.ts`
Expected: FAIL, cannot find module `./clips`.

- [ ] **Step 3: Implement `clips.ts`**

```ts
import type { Animation, Document } from '@gltf-transform/core';
import { CLIP_NAMES, NormalizeError, type ClipName } from './spec';

export interface ClipOptions {
  /** Source clip name to standard clip name. `null` deletes the clip, for a rig's walk and run cycles. */
  rename: Record<string, string | null>;
  /** Clips the manifest lists for this piece. Standard clips not listed here are stripped. */
  keep: readonly ClipName[];
}

export interface ClipReport {
  clips: ClipName[];
  warnings: string[];
}

const isStandard = (name: string): name is ClipName => (CLIP_NAMES as readonly string[]).includes(name);

/** Disposing an animation alone leaves its channels and samplers, and so their keyframe accessors, in the file. */
function dropClip(anim: Animation): void {
  for (const channel of anim.listChannels()) {
    const sampler = channel.getSampler();
    channel.dispose();
    sampler?.dispose();
  }
  anim.dispose();
}

export function applyClips(doc: Document, piece: string, opts: ClipOptions): ClipReport {
  const root = doc.getRoot();
  const warnings: string[] = [];

  for (const anim of root.listAnimations()) {
    const from = anim.getName();
    if (!Object.hasOwn(opts.rename, from)) continue;
    const to = opts.rename[from];
    if (to === null || to === undefined) dropClip(anim);
    else anim.setName(to);
  }

  const strays = root.listAnimations().map((a) => a.getName()).filter((n) => !isStandard(n));
  if (strays.length > 0) {
    throw new NormalizeError(
      piece,
      `clips outside the standard five remain: ${strays.map((s) => JSON.stringify(s)).join(', ')}. ` +
        `Map each with --rename "name=idle|attack|hit|die|victory", or "name=" to delete it.`,
    );
  }

  const seen = new Set<string>();
  for (const anim of root.listAnimations()) {
    if (seen.has(anim.getName())) throw new NormalizeError(piece, `two clips are named "${anim.getName()}"`);
    seen.add(anim.getName());
  }

  for (const anim of root.listAnimations()) {
    if (!opts.keep.includes(anim.getName() as ClipName)) dropClip(anim);
  }

  const have = root.listAnimations().map((a) => a.getName());
  const missing = opts.keep.filter((c) => !have.includes(c));
  if (missing.length > 0) {
    throw new NormalizeError(piece, `the manifest lists clips the model does not have: ${missing.join(', ')}`);
  }

  const idle = root.listAnimations().find((a) => a.getName() === 'idle');
  if (idle) {
    const snapped = closeLoop(idle);
    if (snapped > 0) warnings.push(`idle did not loop; snapped the last keyframe of ${snapped} channel(s) to the first`);
    if (idle.listChannels().some((c) => c.getSampler()?.getInterpolation() === 'CUBICSPLINE')) {
      warnings.push('idle has cubic-spline channels; their loop was not checked');
    }
  }

  return { clips: CLIP_NAMES.filter((c) => have.includes(c)), warnings };
}

/** Makes each channel's last keyframe equal its first. Cubic-spline channels are skipped. Returns how many changed. */
export function closeLoop(anim: Animation): number {
  let snapped = 0;
  for (const channel of anim.listChannels()) {
    const sampler = channel.getSampler();
    const output = sampler?.getOutput();
    const values = output?.getArray();
    if (!sampler || !output || !values || sampler.getInterpolation() === 'CUBICSPLINE') continue;
    const width = output.getElementSize();
    const last = values.length - width;
    let differs = false;
    for (let i = 0; i < width; i++) {
      if (Math.abs((values[last + i] ?? 0) - (values[i] ?? 0)) > 1e-4) differs = true;
    }
    if (!differs) continue;
    for (let i = 0; i < width; i++) values[last + i] = values[i] ?? 0;
    output.setArray(values);
    snapped++;
  }
  return snapped;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tools/art/clips.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/art/clips.ts tools/art/clips.test.ts
git commit -m "feat(tools): rename, strip and validate clips and close idle loops"
```

---

### Task 5: Merge animation files onto a rigged model

Meshy's rigging API returns a rigged model with only walk and run clips; every other clip (attack, hit, die, victory) comes back as a separate glb from its Animation API, one glb per action. This task copies those clips onto the one rigged model.

**Files:**
- Create: `tools/art/mergeClips.ts`
- Test: `tools/art/mergeClips.test.ts`

**Interfaces:**
- Consumes: `NormalizeError` from `spec.ts`; fixtures.
- Produces:
  - `interface ClipSource { name: string; doc: Document }`
  - `mergeClips(base: Document, piece: string, sources: readonly ClipSource[]): string[]`. For each source it takes the first animation, copies every channel whose target node name exists in `base` into a new animation called `source.name`, and returns warnings. It throws if the source has no animation, or if no channel matches a node in `base` (a different rig). Accessors are cloned, so the source document can be discarded.

- [ ] **Step 1: Write the failing test**

`tools/art/mergeClips.test.ts`:

```ts
// @vitest-environment node
import { mergeClips } from './mergeClips';
import { readGlb, statueDoc, statueGlb } from './testing/fixtures';

describe('mergeClips', () => {
  test('copies a clip onto the base, retargeting the channel by node name', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true, clips: ['Armature|Attack'] });
    const warnings = mergeClips(base, 'w-king', [{ name: 'attack', doc: source }]);

    expect(warnings).toEqual([]);
    const anim = base.getRoot().listAnimations()[0]!;
    expect(anim.getName()).toBe('attack');
    const channel = anim.listChannels()[0]!;
    expect(channel.getTargetNode()).toBe(base.getRoot().listNodes().find((n) => n.getName() === 'tip'));
    expect(channel.getTargetPath()).toBe('translation');
    expect(Array.from(channel.getSampler()!.getOutput()!.getArray()!)).toEqual([0, 1, 0, 0, expect.closeTo(1.1, 5), 0]);
  });

  test('clones the data, so the source document is not shared', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true, clips: ['x'] });
    mergeClips(base, 'w-king', [{ name: 'hit', doc: source }]);
    const copied = base.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput();
    const original = source.getRoot().listAnimations()[0]!.listChannels()[0]!.getSampler()!.getOutput();
    expect(copied).not.toBe(original);
    expect(copied!.getArray()).not.toBe(original!.getArray());
  });

  test('merges several sources and the result survives a glb round trip', async () => {
    const base = await statueDoc({ skinned: true });
    mergeClips(base, 'w-queen', [
      { name: 'attack', doc: await readGlb(await statueGlb({ skinned: true, clips: ['a'] })) },
      { name: 'die', doc: await readGlb(await statueGlb({ skinned: true, clips: ['b'] })) },
    ]);
    const names = base.getRoot().listAnimations().map((a) => a.getName()).sort();
    expect(names).toEqual(['attack', 'die']);
  });

  test('a source built on a different rig is an error', async () => {
    const base = await statueDoc();
    const source = await statueDoc({ skinned: true, clips: ['Attack'] });
    expect(() => mergeClips(base, 'w-king', [{ name: 'attack', doc: source }])).toThrow(
      /w-king: no channel in the "attack" animation matches a node in the base model; was it made from the same rig\?/,
    );
    expect(base.getRoot().listAnimations()).toHaveLength(0);
  });

  test('a source with no animation is an error', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true });
    expect(() => mergeClips(base, 'w-king', [{ name: 'attack', doc: source }])).toThrow(
      /w-king: the animation file for "attack" contains no animation/,
    );
  });

  test('warns about channels whose target node is missing from the base', async () => {
    const base = await statueDoc({ skinned: true });
    const source = await statueDoc({ skinned: true, clips: ['Attack'] });
    const anim = source.getRoot().listAnimations()[0]!;
    const first = anim.listChannels()[0]!.getSampler()!;
    const ghost = source.createNode('ghost');
    const sampler = source
      .createAnimationSampler()
      .setInput(first.getInput())
      .setOutput(first.getOutput())
      .setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(source.createAnimationChannel().setTargetNode(ghost).setTargetPath('translation').setSampler(sampler));

    const warnings = mergeClips(base, 'w-king', [{ name: 'attack', doc: source }]);
    expect(warnings).toEqual(['"attack": 1 of 2 channels target nodes missing from the base model and were skipped']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/mergeClips.test.ts`
Expected: FAIL, cannot find module `./mergeClips`.

- [ ] **Step 3: Implement `mergeClips.ts`**

```ts
import type { Accessor, Document } from '@gltf-transform/core';
import { NormalizeError } from './spec';

export interface ClipSource {
  /** The name the copied clip gets in the base document. */
  name: string;
  doc: Document;
}

/**
 * Copies the first animation of each source document onto `base`, matching channel targets by
 * node name. Sources are the per-action glb files Meshy's Animation API returns for one rig.
 * Returns warnings about skipped channels.
 */
export function mergeClips(base: Document, piece: string, sources: readonly ClipSource[]): string[] {
  const warnings: string[] = [];
  const buffer = base.getRoot().listBuffers()[0] ?? base.createBuffer();
  const nodes = new Map(base.getRoot().listNodes().map((n) => [n.getName(), n] as const));
  const copy = (a: Accessor) =>
    base
      .createAccessor()
      .setType(a.getType())
      .setArray(a.getArray()?.slice() ?? new Float32Array(0))
      .setNormalized(a.getNormalized())
      .setBuffer(buffer);

  for (const { name, doc } of sources) {
    const source = doc.getRoot().listAnimations()[0];
    if (!source) throw new NormalizeError(piece, `the animation file for "${name}" contains no animation`);

    const out = base.createAnimation(name);
    let matched = 0;
    const channels = source.listChannels();
    for (const channel of channels) {
      const node = nodes.get(channel.getTargetNode()?.getName() ?? '');
      const sampler = channel.getSampler();
      const path = channel.getTargetPath();
      const input = sampler?.getInput();
      const output = sampler?.getOutput();
      if (!node || !sampler || !path || !input || !output) continue;
      const copied = base
        .createAnimationSampler()
        .setInput(copy(input))
        .setOutput(copy(output))
        .setInterpolation(sampler.getInterpolation());
      out.addSampler(copied).addChannel(base.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(copied));
      matched++;
    }

    if (matched === 0) {
      out.dispose();
      throw new NormalizeError(
        piece,
        `no channel in the "${name}" animation matches a node in the base model; was it made from the same rig?`,
      );
    }
    if (matched < channels.length) {
      warnings.push(`"${name}": ${channels.length - matched} of ${channels.length} channels target nodes missing from the base model and were skipped`);
    }
  }
  return warnings;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tools/art/mergeClips.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/art/mergeClips.ts tools/art/mergeClips.test.ts
git commit -m "feat(tools): merge animation files onto a rigged model"
```

---

### Task 6: Shrink textures and enforce the 2 MB budget

**Files:**
- Create: `tools/art/textures.ts`
- Test: `tools/art/textures.test.ts`

**Interfaces:**
- Consumes: `MAX_MODEL_BYTES`, `MAX_TEXTURE_PX`, `NormalizeError` from `spec.ts`.
- Produces:
  - `slim(doc: Document, piece: string, maxTexturePx: number): Promise<void>`. It prunes unused data, dedups, and re-encodes every texture as JPEG no larger than `maxTexturePx` on a side, without enlarging smaller ones. It throws unless `maxTexturePx` is a whole number from 16 to 2048.
  - `assertSize(piece: string, bytes: number): void` throws at 2 MB or more.

- [ ] **Step 1: Write the failing test**

`tools/art/textures.test.ts`:

```ts
// @vitest-environment node
import sharp from 'sharp';
import { assertSize, slim } from './textures';
import { statueDoc } from './testing/fixtures';

const firstTexture = async (doc: Awaited<ReturnType<typeof statueDoc>>) => {
  const texture = doc.getRoot().listTextures()[0]!;
  return { meta: await sharp(texture.getImage()!).metadata(), mime: texture.getMimeType() };
};

describe('slim', () => {
  test('shrinks an oversize texture and re-encodes it as JPEG', async () => {
    const doc = await statueDoc({ texturePx: 2048 });
    await slim(doc, 'w-king', 1024);
    const { meta, mime } = await firstTexture(doc);
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(mime).toBe('image/jpeg');
  });

  test('does not enlarge a smaller texture', async () => {
    const doc = await statueDoc({ texturePx: 512 });
    await slim(doc, 'w-king', 1024);
    expect((await firstTexture(doc)).meta.width).toBe(512);
  });

  test('accepts the spec ceiling of 2048', async () => {
    const doc = await statueDoc({ texturePx: 256 });
    await expect(slim(doc, 'w-king', 2048)).resolves.toBeUndefined();
  });

  test.each([4096, 8, 1000.5])('rejects a max texture size of %s', async (px) => {
    const doc = await statueDoc({ texturePx: 256 });
    await expect(slim(doc, 'w-king', px)).rejects.toThrow(/w-king: max texture size must be a whole number from 16 to 2048/);
  });

  test('a model without textures passes through', async () => {
    const doc = await statueDoc();
    await expect(slim(doc, 'w-king', 1024)).resolves.toBeUndefined();
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
  });
});

describe('assertSize', () => {
  test('accepts a file just under 2 MB', () => {
    expect(() => assertSize('w-king', 2 * 1024 * 1024 - 1)).not.toThrow();
  });

  test('rejects a file at 2 MB with the size and a fix', () => {
    expect(() => assertSize('w-king', 2 * 1024 * 1024)).toThrow(
      /w-king: 2\.00 MB is over the 2 MB limit\. Lower --max-texture or regenerate with a lower target_polycount\./,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/textures.test.ts`
Expected: FAIL, cannot find module `./textures`.

- [ ] **Step 3: Implement `textures.ts`**

```ts
import sharp from 'sharp';
import type { Document } from '@gltf-transform/core';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import { MAX_MODEL_BYTES, MAX_TEXTURE_PX, NormalizeError } from './spec';

/** Drops unused data and re-encodes textures as JPEG no larger than `maxTexturePx`. Alpha is not kept. */
export async function slim(doc: Document, piece: string, maxTexturePx: number): Promise<void> {
  if (!Number.isInteger(maxTexturePx) || maxTexturePx < 16 || maxTexturePx > MAX_TEXTURE_PX) {
    throw new NormalizeError(piece, `max texture size must be a whole number from 16 to ${MAX_TEXTURE_PX}, got ${maxTexturePx}`);
  }
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [maxTexturePx, maxTexturePx], quality: 85 }),
  );
}

export function assertSize(piece: string, bytes: number): void {
  if (bytes >= MAX_MODEL_BYTES) {
    throw new NormalizeError(
      piece,
      `${(bytes / 1024 / 1024).toFixed(2)} MB is over the 2 MB limit. Lower --max-texture or regenerate with a lower target_polycount.`,
    );
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tools/art/textures.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/art/textures.ts tools/art/textures.test.ts
git commit -m "feat(tools): shrink textures and enforce the 2 MB model budget"
```

---

### Task 7: `normalizeModel`, checked against three's loader

**Files:**
- Create: `tools/art/normalize.ts`
- Test: `tools/art/normalize.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 6.
- Produces:
  - `interface NormalizeOptions { piece: string; keep: readonly ClipName[]; rename?: Record<string, string | null>; rotateYDeg?: number; maxTexturePx?: number; extraClips?: readonly { name: string; bytes: Uint8Array }[] }`
  - `interface NormalizeReport { piece: string; heightUnits: number; bytes: number; clips: ClipName[]; warnings: string[] }`
  - `interface NormalizeResult { glb: Uint8Array; report: NormalizeReport }`
  - `normalizeModel(input: Uint8Array, opts: NormalizeOptions): Promise<NormalizeResult>`. Order: validate the piece key, read, measure, reject non-Y-up and far-off models, merge `extraClips`, apply clips, transform, slim textures, write, check the size. Every error is a `NormalizeError` whose message starts with the piece key.

- [ ] **Step 1: Write the failing test**

`tools/art/normalize.test.ts`:

```ts
// @vitest-environment node
import sharp from 'sharp';
import { Box3, Vector3, type AnimationClip, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeModel } from './normalize';
import { readGlb, statueGlb } from './testing/fixtures';

/** The same loader the app uses, as an independent check of the conventions. Texture-less models only. */
function loadWithThree(bytes: Uint8Array): Promise<{ scene: Group; animations: AnimationClip[] }> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', (g) => res(g), rej));
}

async function boxOf(bytes: Uint8Array) {
  const { scene } = await loadWithThree(bytes);
  scene.updateMatrixWorld(true);
  return new Box3().setFromObject(scene, true);
}

const FIVE = ['idle', 'attack', 'hit', 'die', 'victory'] as const;
const RIG_NAMES: Record<string, string | null> = {
  'Armature|Idle': 'idle',
  'Armature|Attack': 'attack',
  'Armature|Hit': 'hit',
  'Armature|Die': 'die',
  'Armature|Victory': 'victory',
  Walking: null,
};

describe('normalizeModel', () => {
  test('a rigged king ends on the spec conventions, as three sees it', async () => {
    const input = await statueGlb({ skinned: true, size: [0.5, 3, 0.5], center: [4, 7, 1], clips: Object.keys(RIG_NAMES) });
    const { glb, report } = await normalizeModel(input, { piece: 'w-king', keep: FIVE, rename: RIG_NAMES });

    const box = await boxOf(glb);
    const center = box.getCenter(new Vector3());
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.0, 3);
    expect(Math.abs(center.x)).toBeLessThan(0.02);
    expect(Math.abs(center.z)).toBeLessThan(0.02);

    const { animations } = await loadWithThree(glb);
    expect(animations.map((a) => a.name).sort()).toEqual([...FIVE].sort());
    expect(report).toMatchObject({ piece: 'w-king', clips: [...FIVE], warnings: [] });
    expect(report.heightUnits).toBeCloseTo(1, 4);
    expect(report.bytes).toBe(glb.byteLength);
  });

  test('pruning keeps the skeleton the clips animate', async () => {
    const input = await statueGlb({ skinned: true, clips: ['idle'] });
    const { glb } = await normalizeModel(input, { piece: 'w-queen', keep: ['idle'] });
    const names = (await readGlb(glb)).getRoot().listNodes().map((n) => n.getName());
    expect(names).toEqual(expect.arrayContaining(['normalized', 'root', 'tip', 'body']));
  });

  test('a dropped clip leaves no orphaned keyframe data in the output', async () => {
    const input = await statueGlb({ skinned: true, clips: ['Walking', 'idle'] });
    const { glb } = await normalizeModel(input, { piece: 'w-king', keep: ['idle'], rename: { Walking: null } });
    // position, indices, joints, weights, inverse bind matrices, plus the one kept clip's time and value
    expect((await readGlb(glb)).getRoot().listAccessors()).toHaveLength(7);
  });

  test('does not print the library\'s progress lines, so a whole-set build stays readable', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const input = await statueGlb({ skinned: true, clips: ['Walking', 'idle'] });
    await normalizeModel(input, { piece: 'w-king', keep: ['idle'], rename: { Walking: null } });
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test('a rigid pawn keeps no clips and gets the pawn height', async () => {
    const input = await statueGlb({ size: [0.5, 1, 0.5], center: [0, 0.5, 0], clips: ['idle'] });
    const { glb, report } = await normalizeModel(input, { piece: 'b-pawn', keep: [] });
    expect(report.clips).toEqual([]);
    expect((await loadWithThree(glb)).animations).toEqual([]);
    expect((await boxOf(glb)).max.y).toBeCloseTo(0.55, 3);
  });

  test('extra clip files are merged onto the rigged base', async () => {
    const input = await statueGlb({ skinned: true });
    const attack = await statueGlb({ skinned: true, clips: ['whatever'] });
    const { glb, report } = await normalizeModel(input, {
      piece: 'b-bishop',
      keep: ['attack'],
      extraClips: [{ name: 'attack', bytes: attack }],
    });
    expect(report.clips).toEqual(['attack']);
    expect((await loadWithThree(glb)).animations.map((a) => a.name)).toEqual(['attack']);
  });

  test('rotateYDeg turns the model', async () => {
    const input = await statueGlb({ size: [1, 2, 0.4], center: [0, 1, 0] });
    const { glb } = await normalizeModel(input, { piece: 'w-knight', keep: [], rotateYDeg: 90 });
    const size = (await boxOf(glb)).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(size.x);
  });

  test('textures are shrunk to 1024 by default and to 2048 on request', async () => {
    const input = await statueGlb({ texturePx: 2048 });
    const width = async (maxTexturePx?: number) => {
      const { glb } = await normalizeModel(input, { piece: 'w-rook', keep: [], maxTexturePx });
      const image = (await readGlb(glb)).getRoot().listTextures()[0]!.getImage()!;
      return (await sharp(image).metadata()).width;
    };
    expect(await width()).toBe(1024);
    expect(await width(2048)).toBe(2048);
  });

  test('a Z-up model is rejected with the piece key in the message', async () => {
    const input = await statueGlb({ size: [0.4, 0.4, 2], center: [0, 0, 1] });
    await expect(normalizeModel(input, { piece: 'w-pawn', keep: [] })).rejects.toThrow(/^w-pawn: does not look Y-up/);
  });

  test('geometry far from the origin is rejected', async () => {
    const input = await statueGlb({ center: [30, 1, 0] });
    await expect(normalizeModel(input, { piece: 'w-pawn', keep: [] })).rejects.toThrow(/^w-pawn: .*from the origin/);
  });

  test('an unknown piece key is rejected before anything is read', async () => {
    await expect(normalizeModel(new Uint8Array([1, 2, 3]), { piece: 'w-dragon', keep: [] })).rejects.toThrow(
      /^w-dragon: unknown piece key/,
    );
  });

  test('bytes that are not a glb are rejected', async () => {
    await expect(normalizeModel(new Uint8Array([1, 2, 3]), { piece: 'w-king', keep: [] })).rejects.toThrow(
      /^w-king: the model is not a readable glb/,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/normalize.test.ts`
Expected: FAIL, cannot find module `./normalize`.

- [ ] **Step 3: Implement `normalize.ts`**

```ts
import type { Document } from '@gltf-transform/core';
import { applyClips } from './clips';
import { assertNotFarOff, assertYUp, measure, theScene } from './inspect';
import { io } from './io';
import { mergeClips, type ClipSource } from './mergeClips';
import { DEFAULT_TEXTURE_PX, NormalizeError, pieceHeight, type ClipName } from './spec';
import { assertSize, slim } from './textures';
import { normalizeTransform } from './transform';

export interface NormalizeOptions {
  /** Manifest key, for example `w-king`. */
  piece: string;
  /** Clips the manifest will list for this piece. Empty for a rigid piece. */
  keep: readonly ClipName[];
  /** Source clip name to standard name, or `null` to delete the clip. */
  rename?: Record<string, string | null>;
  /** Turn the model about Y first, for exports that do not face +Z. */
  rotateYDeg?: number;
  /** Texture size ceiling in pixels, up to 2048. Default 1024. */
  maxTexturePx?: number;
  /** Animation-only files (for example Meshy Animation API output); each `name` becomes a clip. */
  extraClips?: readonly { name: string; bytes: Uint8Array }[];
}

export interface NormalizeReport {
  piece: string;
  heightUnits: number;
  bytes: number;
  clips: ClipName[];
  warnings: string[];
}

export interface NormalizeResult {
  glb: Uint8Array;
  report: NormalizeReport;
}

async function read(bytes: Uint8Array, piece: string, what: string): Promise<Document> {
  try {
    return await io.readBinary(bytes);
  } catch (e) {
    throw new NormalizeError(piece, `${what} is not a readable glb: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function normalizeModel(input: Uint8Array, opts: NormalizeOptions): Promise<NormalizeResult> {
  const { piece } = opts;
  const targetHeight = pieceHeight(piece);
  const doc = await read(input, piece, 'the model');
  const scene = theScene(doc, piece);

  const before = measure(scene, piece);
  assertYUp(before, piece);
  assertNotFarOff(before, piece);

  const warnings: string[] = [];
  if (opts.extraClips && opts.extraClips.length > 0) {
    const sources: ClipSource[] = [];
    for (const clip of opts.extraClips) {
      sources.push({ name: clip.name, doc: await read(clip.bytes, piece, `the animation file for "${clip.name}"`) });
    }
    warnings.push(...mergeClips(doc, piece, sources));
  }

  const clipReport = applyClips(doc, piece, { rename: opts.rename ?? {}, keep: opts.keep });
  warnings.push(...clipReport.warnings);

  normalizeTransform(doc, scene, piece, { targetHeight, rotateYDeg: opts.rotateYDeg });
  await slim(doc, piece, opts.maxTexturePx ?? DEFAULT_TEXTURE_PX);

  const glb = await io.writeBinary(doc);
  assertSize(piece, glb.byteLength);

  return {
    glb,
    report: { piece, heightUnits: measure(scene, piece).size[1], bytes: glb.byteLength, clips: clipReport.clips, warnings },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tools/art/normalize.test.ts`
Expected: PASS, 12 tests. If the rigged-king test fails on the animation names, check that `prune()` kept the joints (the second test isolates that).

- [ ] **Step 5: Run the whole art suite and typecheck**

Run: `pnpm test tools/art && pnpm typecheck`
Expected: all art tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add tools/art/normalize.ts tools/art/normalize.test.ts
git commit -m "feat(tools): add normalizeModel and verify its output with three's loader"
```

---

### Task 8: The `art` CLI and its `normalize` command

**Files:**
- Create: `tools/art/args.ts`, `tools/art/cli.ts`
- Test: `tools/art/args.test.ts`, `tools/art/cli.test.ts`
- Modify: `package.json` (add the `art` script)

**Interfaces:**
- Consumes: `normalizeModel`, `NormalizeOptions`, `NormalizeReport`; `CLIP_NAMES`, `ClipName`, `NormalizeError`.
- Produces:
  - `args.ts`: `class UsageError extends Error`; `interface NormalizeCommand { input: string; output: string; anims: { name: ClipName; path: string }[]; options: Omit<NormalizeOptions, 'extraClips'> }`; `parseNormalizeArgs(argv: string[]): NormalizeCommand`. Flags: `--piece`, `--in`, `--out` (required); `--keep a,b`; `--rename name=target` (repeatable; `name=` deletes); `--anim clip=path.glb` (repeatable); `--rotate-y deg`; `--max-texture px`.
  - `cli.ts`: `runNormalize(argv: string[]): Promise<NormalizeReport>`, `formatReport(r): string`, `main(argv): Promise<number>` (exit code). `package.json` gets `"art": "tsx tools/art/cli.ts"`.

- [ ] **Step 1: Write the failing argument tests**

`tools/art/args.test.ts`:

```ts
// @vitest-environment node
import { parseNormalizeArgs, UsageError } from './args';

const base = ['--piece', 'w-king', '--in', 'raw/w-king.glb', '--out', 'out/w-king.glb'];

describe('parseNormalizeArgs', () => {
  test('parses a full command', () => {
    const cmd = parseNormalizeArgs([
      ...base,
      '--keep', 'idle,attack',
      '--rename', 'Armature|Attack=attack',
      '--rename', 'Walking=',
      '--anim', 'hit=raw/hit.glb',
      '--rotate-y', '180',
      '--max-texture', '2048',
    ]);
    expect(cmd.input).toBe('raw/w-king.glb');
    expect(cmd.output).toBe('out/w-king.glb');
    expect(cmd.anims).toEqual([{ name: 'hit', path: 'raw/hit.glb' }]);
    expect(cmd.options).toEqual({
      piece: 'w-king',
      keep: ['idle', 'attack'],
      rename: { 'Armature|Attack': 'attack', Walking: null },
      rotateYDeg: 180,
      maxTexturePx: 2048,
    });
  });

  test('defaults to a rigid piece with no renames', () => {
    expect(parseNormalizeArgs(base).options).toEqual({ piece: 'w-king', keep: [], rename: {} });
  });

  test.each(['--piece', '--in', '--out'])('requires %s', (flag) => {
    const i = base.indexOf(flag);
    const argv = [...base.slice(0, i), ...base.slice(i + 2)];
    expect(() => parseNormalizeArgs(argv)).toThrow(new RegExp(`${flag} is required`));
  });

  test('rejects a clip name that is not one of the standard five', () => {
    expect(() => parseNormalizeArgs([...base, '--keep', 'idle,walk'])).toThrow(/"walk" is not one of idle, attack, hit, die, victory/);
    expect(() => parseNormalizeArgs([...base, '--anim', 'walk=w.glb'])).toThrow(/--anim: "walk" is not one of/);
  });

  test('rejects a malformed --rename', () => {
    expect(() => parseNormalizeArgs([...base, '--rename', 'Walking'])).toThrow(/--rename expects name=target, got "Walking"/);
  });

  test('rejects non-numeric numbers', () => {
    expect(() => parseNormalizeArgs([...base, '--rotate-y', 'left'])).toThrow(/--rotate-y expects a number, got "left"/);
  });

  test('rejects an unknown flag as a UsageError', () => {
    expect(() => parseNormalizeArgs([...base, '--frobnicate'])).toThrow(UsageError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/args.test.ts`
Expected: FAIL, cannot find module `./args`.

- [ ] **Step 3: Implement `args.ts`**

```ts
import { parseArgs } from 'node:util';
import type { NormalizeOptions } from './normalize';
import { CLIP_NAMES, type ClipName } from './spec';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface NormalizeCommand {
  input: string;
  output: string;
  anims: { name: ClipName; path: string }[];
  options: Omit<NormalizeOptions, 'extraClips'>;
}

const isClip = (name: string): name is ClipName => (CLIP_NAMES as readonly string[]).includes(name);
const clipList = CLIP_NAMES.join(', ');

function splitPair(raw: string, flag: string): [string, string] {
  const at = raw.indexOf('=');
  if (at < 1) throw new UsageError(`${flag} expects name=target, got "${raw}"`);
  return [raw.slice(0, at), raw.slice(at + 1)];
}

function toNumber(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`${flag} expects a number, got "${raw}"`);
  return n;
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      options: {
        piece: { type: 'string' },
        in: { type: 'string' },
        out: { type: 'string' },
        keep: { type: 'string' },
        rename: { type: 'string', multiple: true },
        anim: { type: 'string', multiple: true },
        'rotate-y': { type: 'string' },
        'max-texture': { type: 'string' },
      },
    }).values;
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
}

export function parseNormalizeArgs(argv: string[]): NormalizeCommand {
  const v = parse(argv);
  if (!v.piece) throw new UsageError('--piece is required');
  if (!v.in) throw new UsageError('--in is required');
  if (!v.out) throw new UsageError('--out is required');

  const keep = (v.keep ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      if (!isClip(name)) throw new UsageError(`--keep: "${name}" is not one of ${clipList}`);
      return name;
    });

  const rename: Record<string, string | null> = {};
  for (const raw of v.rename ?? []) {
    const [from, to] = splitPair(raw, '--rename');
    rename[from] = to === '' ? null : to;
  }

  const anims = (v.anim ?? []).map((raw) => {
    const [name, path] = splitPair(raw, '--anim');
    if (!isClip(name)) throw new UsageError(`--anim: "${name}" is not one of ${clipList}`);
    if (path === '') throw new UsageError(`--anim expects clip=path.glb, got "${raw}"`);
    return { name, path };
  });

  return {
    input: v.in,
    output: v.out,
    anims,
    options: {
      piece: v.piece,
      keep,
      rename,
      rotateYDeg: toNumber(v['rotate-y'], '--rotate-y'),
      maxTexturePx: toNumber(v['max-texture'], '--max-texture'),
    },
  };
}
```

- [ ] **Step 4: Run the argument tests and watch them pass**

Run: `pnpm test tools/art/args.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing CLI test**

`tools/art/cli.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport, main, runNormalize } from './cli';
import { readGlb, statueGlb } from './testing/fixtures';

const names = async (path: string) =>
  (await readGlb(new Uint8Array(readFileSync(path)))).getRoot().listAnimations().map((a) => a.getName()).sort();

describe('runNormalize', () => {
  test('reads a file, writes the fixed model into a new folder and returns the report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-cli-'));
    writeFileSync(join(dir, 'raw.glb'), await statueGlb({ skinned: true, size: [0.5, 3, 0.5], center: [2, 5, 0], clips: ['Idle', 'Fight'] }));
    const out = join(dir, 'nested', 'out.glb');
    const report = await runNormalize([
      '--piece', 'w-queen', '--in', join(dir, 'raw.glb'), '--out', out,
      '--keep', 'idle,attack', '--rename', 'Idle=idle', '--rename', 'Fight=attack',
    ]);
    expect(report.clips).toEqual(['idle', 'attack']);
    expect(await names(out)).toEqual(['attack', 'idle']);
  });

  test('--anim merges a separate animation file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-cli-'));
    writeFileSync(join(dir, 'rig.glb'), await statueGlb({ skinned: true }));
    writeFileSync(join(dir, 'die.glb'), await statueGlb({ skinned: true, clips: ['Death'] }));
    const out = join(dir, 'out.glb');
    await runNormalize([
      '--piece', 'b-king', '--in', join(dir, 'rig.glb'), '--out', out,
      '--keep', 'die', '--anim', `die=${join(dir, 'die.glb')}`,
    ]);
    expect(await names(out)).toEqual(['die']);
  });
});

describe('formatReport', () => {
  test('lists height, size, clips and warnings', () => {
    const text = formatReport({ piece: 'w-king', heightUnits: 1, bytes: 51200, clips: ['idle'], warnings: ['idle did not loop'] });
    expect(text).toBe('w-king: 1.000 units tall, 50 KB, clips: idle\n  warning: idle did not loop');
  });

  test('says so when a piece has no clips', () => {
    expect(formatReport({ piece: 'w-pawn', heightUnits: 0.55, bytes: 1024, clips: [], warnings: [] })).toContain('none (rigid fallback)');
  });
});

describe('main', () => {
  test('a NormalizeError prints its message and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-cli-'));
    writeFileSync(join(dir, 'z.glb'), await statueGlb({ size: [0.4, 0.4, 2], center: [0, 0, 1] }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['normalize', '--piece', 'w-pawn', '--in', join(dir, 'z.glb'), '--out', join(dir, 'o.glb')]);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^w-pawn: does not look Y-up/));
    error.mockRestore();
  });

  test('a usage mistake prints the message and the usage text and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['normalize', '--piece', 'w-king'])).toBe(1);
    expect(error).toHaveBeenCalledWith('--in is required');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage:'));
    error.mockRestore();
  });

  test('a missing input file prints one line instead of a stack trace and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['normalize', '--piece', 'w-king', '--in', '/no/such/dir/x.glb', '--out', '/tmp/never.glb']);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('cannot open /no/such/dir/x.glb: no such file or directory');
    error.mockRestore();
  });

  test('an unknown command exits 1 with the usage text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['frobnicate'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage:'));
    error.mockRestore();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm test tools/art/cli.test.ts`
Expected: FAIL, cannot find module `./cli`.

- [ ] **Step 7: Implement `cli.ts` and add the script**

`tools/art/cli.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNormalizeArgs, UsageError } from './args';
import { normalizeModel, type NormalizeReport } from './normalize';
import { NormalizeError } from './spec';

const USAGE = `usage:
  pnpm art normalize --piece w-king --in raw.glb --out out.glb
      [--keep idle,attack,hit,die,victory] [--rename "Old|Name=attack" | "Old="]
      [--anim attack=attack.glb] [--rotate-y 180] [--max-texture 1024]`;

const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

export function formatReport(r: NormalizeReport): string {
  const clips = r.clips.length > 0 ? r.clips.join(', ') : 'none (rigid fallback)';
  const lines = [`${r.piece}: ${r.heightUnits.toFixed(3)} units tall, ${(r.bytes / 1024).toFixed(0)} KB, clips: ${clips}`];
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

export async function runNormalize(argv: string[]): Promise<NormalizeReport> {
  const cmd = parseNormalizeArgs(argv);
  const extraClips = cmd.anims.map((a) => ({ name: a.name, bytes: bytesOf(a.path) }));
  const { glb, report } = await normalizeModel(bytesOf(cmd.input), { ...cmd.options, extraClips });
  mkdirSync(dirname(cmd.output), { recursive: true });
  writeFileSync(cmd.output, glb);
  return report;
}

/** Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'normalize') {
      console.log(formatReport(await runNormalize(rest)));
      return 0;
    }
    console.error(USAGE);
    return 1;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      console.error(USAGE);
      return 1;
    }
    if (e instanceof NormalizeError) {
      console.error(e.message);
      return 1;
    }
    const io = e as NodeJS.ErrnoException;
    if (io.code === 'ENOENT' && io.path) {
      console.error(`cannot open ${io.path}: no such file or directory`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

In `package.json` `scripts`, add after `"dev-packs"`:

```json
    "art": "tsx tools/art/cli.ts",
```

- [ ] **Step 8: Run the tests, typecheck, and try it on a real file**

Run: `pnpm test tools/art && pnpm typecheck`
Expected: PASS, typecheck clean.

Smoke test the real process on files (use the scratchpad folder, not the repo). Top-level `await` needs an ES module, so name the helper `.mts`:

```bash
cat > /tmp/art-make.mts <<'SCRIPT'
import { writeFileSync } from 'node:fs';
import { statueGlb } from '/ABSOLUTE/PATH/TO/repo/tools/art/testing/fixtures';
writeFileSync('/tmp/rig.glb', await statueGlb({ skinned: true, size: [0.5, 3, 0.5], center: [2, 5, 0], clips: ['Walking'] }));
writeFileSync('/tmp/attack.glb', await statueGlb({ skinned: true, clips: ['Fight'] }));
writeFileSync('/tmp/zup.glb', await statueGlb({ size: [0.4, 0.4, 2], center: [0, 0, 1] }));
SCRIPT
pnpm exec tsx /tmp/art-make.mts
pnpm art normalize --piece w-king --in /tmp/rig.glb --out /tmp/out/w-king.glb --keep attack --rename Walking= --anim attack=/tmp/attack.glb
pnpm art normalize --piece w-pawn --in /tmp/zup.glb --out /tmp/out/x.glb
pnpm art normalize --piece w-king --in /tmp/rig.glb --out /tmp/out/y.glb --keep idle
pnpm exec gltf-transform validate /tmp/out/w-king.glb
```

Expected, in order: `w-king: 1.000 units tall, 2 KB, clips: attack` (exit 0); `w-pawn: does not look Y-up: ...` (exit 1, no file written); `w-king: clips outside the standard five remain: "Walking". ...` (exit 1, no file written); validator says `No errors found` with one expected warning, `NODE_SKINNED_MESH_NON_ROOT` (see the README's "Checking a result"), and no `UNUSED_OBJECT` notes.

- [ ] **Step 9: Commit**

```bash
git add tools/art/args.ts tools/art/args.test.ts tools/art/cli.ts tools/art/cli.test.ts package.json
git commit -m "feat(tools): add the art CLI with a normalize command"
```

---

### Task 9: Build a whole set pack, and guard it from the dev-pack generator

**Files:**
- Create: `tools/art/generator.ts`, `tools/art/buildSet.ts`, `tools/art/README.md`, `tools/dev-pack/guard.test.ts`
- Test: `tools/art/buildSet.test.ts`
- Modify: `tools/art/cli.ts` (add `build-set`), `tools/dev-pack/generate.ts` (guard), `.gitignore` (`art-src/`)

**Interfaces:**
- Consumes: `normalizeModel`, `NormalizeReport`, `NormalizeError`, `ClipName`; `ALL_PIECE_KEYS`, `SetManifest` from `src/packs/types.ts`; `parseSetManifest` from `src/packs/validate.ts`.
- Produces:
  - `generator.ts`: `ART_GENERATOR = 'art-pipeline'`.
  - `buildSet.ts`: `interface PieceSource { model: string; rotateY?: number; keep?: ClipName[]; rename?: Record<string, string | null>; clips?: Partial<Record<ClipName, string>>; maxTexture?: number }`; `interface SetSource { id: string; name: string; version: number; sides: SetManifest['sides']; audio?: Record<string, string>; pieces: Record<string, PieceSource> }`; `buildSet(srcDir: string, outDir: string): Promise<NormalizeReport[]>`. It reads `<srcDir>/set.json`, requires exactly the twelve piece keys, normalizes each model (paths in `set.json` are relative to `srcDir`) into `<outDir>/models/<key>.glb`, copies audio into `<outDir>/audio/`, validates the manifest with `parseSetManifest`, and writes `<outDir>/manifest.json` last, stamped `"generator": "art-pipeline"`. `keep` defaults to `[]` (a rigid piece). `clips` maps a standard clip name to an animation-only glb to merge.
  - `main(['build-set', srcDir, outDir])` runs it and prints one report line per piece.
  - `generateDevPacks` throws before writing anything if either dev-pack manifest already carries the art-pipeline stamp.

- [ ] **Step 1: Write the failing `buildSet` test**

`tools/art/buildSet.test.ts`:

```ts
// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ALL_PIECE_KEYS } from '../../src/packs/types';
import { parseSetManifest } from '../../src/packs/validate';
import { buildSet } from './buildSet';
import { statueGlb } from './testing/fixtures';

const FIVE = ['idle', 'attack', 'hit', 'die', 'victory'] as const;
const isRigged = (key: string) => ['king', 'queen', 'bishop', 'knight'].some((n) => key.endsWith(`-${n}`));

const put = (root: string, rel: string, data: Uint8Array | string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), data);
};

async function makeSource(brokenPiece?: string): Promise<string> {
  const src = mkdtempSync(join(tmpdir(), 'art-src-'));
  const pieces: Record<string, unknown> = {};
  for (const key of ALL_PIECE_KEYS) {
    const rigged = isRigged(key);
    const broken = key === brokenPiece;
    put(
      src,
      `raw/${key}.glb`,
      await statueGlb({
        skinned: rigged,
        size: broken ? [0.4, 0.4, 2] : [0.5, 3, 0.5],
        center: broken ? [0, 0, 1] : [2, 4, 0],
        clips: rigged ? FIVE.map((c) => `Rig|${c}`) : ['idle'],
      }),
    );
    pieces[key] = rigged
      ? { model: `raw/${key}.glb`, keep: [...FIVE], rename: Object.fromEntries(FIVE.map((c) => [`Rig|${c}`, c])) }
      : { model: `raw/${key}.glb` };
  }
  put(src, 'sfx/attack.wav', 'RIFFxxxxWAVE');
  put(
    src,
    'set.json',
    JSON.stringify({
      id: 'test-set',
      name: 'Test Set',
      version: 2,
      sides: {
        w: { name: 'Light', color: '#ffffff', impactEffect: 'light' },
        b: { name: 'Dark', color: '#000000', impactEffect: 'fire' },
      },
      audio: { attack: 'sfx/attack.wav' },
      pieces,
    }),
  );
  return src;
}

function editConfig(src: string, edit: (config: any) => void) {
  const path = join(src, 'set.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  edit(config);
  writeFileSync(path, JSON.stringify(config));
}

const outDir = () => join(mkdtempSync(join(tmpdir(), 'art-out-')), 'set');

describe('buildSet', () => {
  test('builds twelve models, copies audio and writes a valid stamped manifest', async () => {
    const out = outDir();
    const reports = await buildSet(await makeSource(), out);

    expect(reports).toHaveLength(12);
    const raw = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(raw.generator).toBe('art-pipeline');
    const manifest = parseSetManifest(raw);
    expect(manifest).toMatchObject({ id: 'test-set', name: 'Test Set', version: 2 });
    expect(manifest.pieces['w-king']).toEqual({ model: 'models/w-king.glb', clips: [...FIVE] });
    expect(manifest.pieces['b-knight']?.clips).toEqual([...FIVE]);
    expect(manifest.pieces['w-pawn']).toEqual({ model: 'models/w-pawn.glb', clips: [] });
    expect(manifest.audio).toEqual({ attack: 'audio/attack.wav' });

    for (const key of ALL_PIECE_KEYS) {
      expect(statSync(join(out, 'models', `${key}.glb`)).size).toBeLessThan(2 * 1024 * 1024);
    }
    expect(readFileSync(join(out, 'audio', 'attack.wav'), 'utf8')).toBe('RIFFxxxxWAVE');
  });

  test('a missing piece is an error and no manifest is written', async () => {
    const src = await makeSource();
    editConfig(src, (c) => delete c.pieces['b-pawn']);
    const out = outDir();
    await expect(buildSet(src, out)).rejects.toThrow(/set\.json: missing pieces: b-pawn/);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
  });

  test('an unknown piece key is an error', async () => {
    const src = await makeSource();
    editConfig(src, (c) => (c.pieces['w-dragon'] = { model: 'raw/w-king.glb' }));
    await expect(buildSet(src, outDir())).rejects.toThrow(/set\.json: unknown pieces: w-dragon/);
  });

  test('a bad model stops the build with its piece key and writes no manifest', async () => {
    const out = outDir();
    await expect(buildSet(await makeSource('w-pawn'), out)).rejects.toThrow(/^w-pawn: does not look Y-up/);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
  });

  test('an invalid manifest field is caught before the manifest is written', async () => {
    const src = await makeSource();
    editConfig(src, (c) => (c.sides.w.color = 'red'));
    const out = outDir();
    await expect(buildSet(src, out)).rejects.toThrow(/Invalid manifest at sides\.w\.color/);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
  });

  test('per-piece clips files are merged', async () => {
    const src = await makeSource();
    put(src, 'raw/w-king-die.glb', await statueGlb({ skinned: true, clips: ['Death'] }));
    editConfig(src, (c) => {
      c.pieces['w-king'] = { model: 'raw/w-king.glb', keep: ['die'], rename: { 'Rig|idle': null, 'Rig|attack': null, 'Rig|hit': null, 'Rig|die': null, 'Rig|victory': null }, clips: { die: 'raw/w-king-die.glb' } };
    });
    const out = outDir();
    await buildSet(src, out);
    expect(parseSetManifest(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).pieces['w-king']?.clips).toEqual(['die']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tools/art/buildSet.test.ts`
Expected: FAIL, cannot find module `./buildSet`.

- [ ] **Step 3: Implement `generator.ts` and `buildSet.ts`**

`tools/art/generator.ts`:

```ts
/** Stamped into a manifest by `buildSet`, so the placeholder generator knows not to overwrite it. */
export const ART_GENERATOR = 'art-pipeline';
```

`tools/art/buildSet.ts`:

```ts
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ALL_PIECE_KEYS, type SetManifest } from '../../src/packs/types';
import { parseSetManifest } from '../../src/packs/validate';
import { ART_GENERATOR } from './generator';
import { normalizeModel, type NormalizeReport } from './normalize';
import { NormalizeError, type ClipName } from './spec';

export interface PieceSource {
  /** The (rigged) glb, relative to the source folder. */
  model: string;
  rotateY?: number;
  /** Clips the manifest lists for this piece. Default `[]`, a rigid piece. */
  keep?: ClipName[];
  rename?: Record<string, string | null>;
  /** Animation-only glb files to merge, by clip name, relative to the source folder. */
  clips?: Partial<Record<ClipName, string>>;
  maxTexture?: number;
}

export interface SetSource {
  id: string;
  name: string;
  version: number;
  sides: SetManifest['sides'];
  /** Sound name to file, relative to the source folder. Copied into `audio/`. */
  audio?: Record<string, string>;
  pieces: Record<string, PieceSource>;
}

const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

function put(path: string, data: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** The manifest is written last, so a failed build never leaves one pointing at missing files. */
export async function buildSet(srcDir: string, outDir: string): Promise<NormalizeReport[]> {
  const source = JSON.parse(readFileSync(join(srcDir, 'set.json'), 'utf8')) as SetSource;

  const missing = ALL_PIECE_KEYS.filter((k) => !Object.hasOwn(source.pieces, k));
  const unknown = Object.keys(source.pieces).filter((k) => !ALL_PIECE_KEYS.includes(k));
  if (missing.length > 0) throw new NormalizeError('set.json', `missing pieces: ${missing.join(', ')}`);
  if (unknown.length > 0) throw new NormalizeError('set.json', `unknown pieces: ${unknown.join(', ')}`);

  const reports: NormalizeReport[] = [];
  const pieces: SetManifest['pieces'] = {};
  for (const key of ALL_PIECE_KEYS) {
    const piece = source.pieces[key]!;
    const extraClips = Object.entries(piece.clips ?? {}).flatMap(([name, path]) =>
      path ? [{ name, bytes: bytesOf(join(srcDir, path)) }] : [],
    );
    const { glb, report } = await normalizeModel(bytesOf(join(srcDir, piece.model)), {
      piece: key,
      keep: piece.keep ?? [],
      rename: piece.rename,
      rotateYDeg: piece.rotateY,
      maxTexturePx: piece.maxTexture,
      extraClips,
    });
    put(join(outDir, 'models', `${key}.glb`), glb);
    pieces[key] = { model: `models/${key}.glb`, clips: report.clips };
    reports.push(report);
  }

  const audio: Record<string, string> = {};
  for (const [sound, path] of Object.entries(source.audio ?? {})) {
    const file = `audio/${basename(path)}`;
    mkdirSync(join(outDir, 'audio'), { recursive: true });
    copyFileSync(join(srcDir, path), join(outDir, file));
    audio[sound] = file;
  }

  const manifest = {
    id: source.id,
    name: source.name,
    version: source.version,
    sides: source.sides,
    pieces,
    audio,
    sequenceOverride: null,
    generator: ART_GENERATOR,
  };
  parseSetManifest(manifest);
  put(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return reports;
}
```

- [ ] **Step 4: Run the `buildSet` test and watch it pass**

Run: `pnpm test tools/art/buildSet.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add `build-set` to the CLI**

In `tools/art/cli.ts`, add the import `import { buildSet } from './buildSet';`, add this line to `USAGE` after the `normalize` block:

```
  pnpm art build-set <source-dir> <out-dir>      (reads <source-dir>/set.json)
```

and add this branch to `main` before the final `console.error(USAGE)`:

```ts
    if (command === 'build-set') {
      const [srcDir, outDir] = rest;
      if (!srcDir || !outDir) throw new UsageError('build-set expects <source-dir> <out-dir>');
      for (const report of await buildSet(srcDir, outDir)) console.log(formatReport(report));
      return 0;
    }
```

Add this test to `tools/art/cli.test.ts` inside `describe('main', ...)`:

```ts
  test('build-set without its two folders is a usage error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['build-set', 'only-one'])).toBe(1);
    expect(error).toHaveBeenCalledWith('build-set expects <source-dir> <out-dir>');
    error.mockRestore();
  });
```

Also add this test beside it, which drives the whole path through `main`:

```ts
  test('build-set builds a set from a source folder and prints one line per piece', async () => {
    const src = mkdtempSync(join(tmpdir(), 'art-cli-set-'));
    const pieces: Record<string, unknown> = {};
    for (const key of ALL_PIECE_KEYS) {
      writeFileSync(join(src, `${key}.glb`), await statueGlb({ size: [0.5, 1, 0.5], center: [0, 0.5, 0] }));
      pieces[key] = { model: `${key}.glb` };
    }
    writeFileSync(
      join(src, 'set.json'),
      JSON.stringify({
        id: 's', name: 'S', version: 1,
        sides: { w: { name: 'A', color: '#ffffff', impactEffect: 'light' }, b: { name: 'B', color: '#000000', impactEffect: 'fire' } },
        pieces,
      }),
    );
    const out = join(src, 'out');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['build-set', src, out])).toBe(0);
    expect(log).toHaveBeenCalledTimes(12);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^w-king: 1\.000 units tall/));
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).generator).toBe('art-pipeline');
    log.mockRestore();
  });
```

(add `import { ALL_PIECE_KEYS } from '../../src/packs/types';` to the test file's imports)

Run: `pnpm test tools/art/cli.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Write the failing dev-pack guard test**

`tools/dev-pack/guard.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDevPacks } from './generate';

const SET = 'packs/sets/angels-vs-demons/manifest.json';
const BOARD = 'packs/boards/stone-lava/manifest.json';

function stamp(dir: string, rel: string) {
  const path = join(dir, rel);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), generator: 'art-pipeline' }));
  return path;
}

describe('dev-pack generator guard', () => {
  test('regenerating over a dev pack is allowed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    generateDevPacks(dir);
    expect(() => generateDevPacks(dir)).not.toThrow();
  });

  test.each([SET, BOARD])('refuses to overwrite an art-pipeline pack (%s) and leaves it untouched', (rel) => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    generateDevPacks(dir);
    const path = stamp(dir, rel);
    const before = readFileSync(path, 'utf8');
    expect(() => generateDevPacks(dir)).toThrow(/refusing to overwrite the art-pipeline pack/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm test tools/dev-pack/guard.test.ts`
Expected: FAIL on the two refuse cases (`generateDevPacks` does not throw).

- [ ] **Step 8: Add the guard to `tools/dev-pack/generate.ts`**

Change the first import line to `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';`, add `import { ART_GENERATOR } from '../art/generator';` with the other imports, and add this function above `generateDevPacks`:

```ts
function refuseToOverwriteArtPack(manifestPath: string) {
  if (!existsSync(manifestPath)) return;
  const { generator } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { generator?: unknown };
  if (generator === ART_GENERATOR) {
    throw new Error(
      `refusing to overwrite the art-pipeline pack at ${manifestPath}; delete that pack's folder first if you want the dev pack back`,
    );
  }
}
```

and make these the first two lines inside `generateDevPacks`, before `written`:

```ts
  refuseToOverwriteArtPack(join(publicDir, 'packs/sets/angels-vs-demons/manifest.json'));
  refuseToOverwriteArtPack(join(publicDir, 'packs/boards/stone-lava/manifest.json'));
```

- [ ] **Step 9: Run the guard test and the existing dev-pack tests**

Run: `pnpm test tools/dev-pack`
Expected: PASS (the existing dev-pack and shapes tests plus 3 new).

- [ ] **Step 10: Ignore the source folder and write the README**

Append to `.gitignore`:

```
art-src/
```

`tools/art/README.md`:

````markdown
# Art pipeline tools

Offline scripts that turn raw generated models into a set pack the app can load. They call no
paid API and read no key.

## Normalize one model

```bash
pnpm art normalize --piece w-king --in art-src/raw/w-king.glb --out /tmp/w-king.glb \
  --keep idle,attack,hit,die,victory \
  --rename "Armature|Idle=idle" --rename "Walking=" \
  --anim attack=art-src/raw/w-king-attack.glb
```

It scales to the piece's height, puts the base on y = 0, centers x and z, shrinks textures to
1024 px (`--max-texture` up to 2048), renames and validates clips, and refuses anything over
2 MB. Add `--rotate-y 180` if the model faces -Z. It stops with a message that starts with the
piece key if the model looks Z-up, sits far from the origin, or has a clip name it cannot map.

`--rename "Old=new"` maps a clip to a standard name; `--rename "Old="` deletes it (use this for a
rig's walk and run cycles). `--anim clip=file.glb` copies the first animation in another glb onto
the model, which is how Meshy's per-action animation files are combined with the rigged model.

## Build a whole set

Put raw files and a `set.json` in `art-src/<set-id>/` (this folder is gitignored), then:

```bash
pnpm art build-set art-src/angels-vs-demons public/packs/sets/angels-vs-demons
```

`set.json`:

```json
{
  "id": "angels-vs-demons", "name": "Angels vs Demons", "version": 2,
  "sides": {
    "w": { "name": "Angels", "color": "#f4e9c8", "impactEffect": "light" },
    "b": { "name": "Demons", "color": "#5a0d0d", "impactEffect": "fire" }
  },
  "audio": { "attack": "sfx/attack.ogg", "hit": "sfx/hit.ogg", "die": "sfx/die.ogg" },
  "pieces": {
    "w-king": { "model": "raw/w-king.glb", "keep": ["idle", "attack", "hit", "die", "victory"],
                "rename": { "Armature|Idle": "idle", "Walking": null },
                "clips": { "attack": "raw/w-king-attack.glb" } },
    "w-pawn": { "model": "raw/w-pawn.glb" }
  }
}
```

All twelve piece keys are required. A piece with no `keep` is rigid and ships without clips.
The manifest is written last and stamped `"generator": "art-pipeline"`, after which
`pnpm dev-packs` will refuse to overwrite that pack.

## Checking a result

Inspect a model with `pnpm exec gltf-transform inspect model.glb` and validate it with
`pnpm exec gltf-transform validate model.glb`. Expect one warning on rigged models,
`NODE_SKINNED_MESH_NON_ROOT`: the normalizer scales a model through a wrapper node above the
skeleton, and for a skinned mesh the glTF spec applies that scale through the joints, which is
what three.js does too. It is not a problem.
````

- [ ] **Step 11: Run every check**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: 296 unit tests pass (the 208 from Plan 2 plus 88 new), typecheck clean, build succeeds.

Run: `pnpm e2e` (start `pnpm dev --port 5173` first if `pnpm` is not on the PATH for Playwright's own web server).
Expected: 9 passed. The public packs are untouched, so nothing should change.

- [ ] **Step 12: Commit**

```bash
git add tools/art tools/dev-pack .gitignore
git commit -m "feat(tools): build a whole set pack and guard it from dev-pack overwrites"
```

---

## As-Built Corrections

Found by running the real CLI on files and `gltf-transform validate` on the output, after every unit test already passed:

1. **Orphaned keyframe data.** `animation.dispose()` removes the animation but not its channels and samplers, so `prune()` kept their accessors and a deleted walk cycle stayed in the file. The clip tests only compared names. Real Meshy walk and run cycles are large enough to threaten the 2 MB budget. Fixed by `dropClip` in `clips.ts`; guarded by a test that checks the channel and sampler are disposed and by a normalize-level test that counts the output's accessors (7, not 9). Confirmed the disposal test fails when the fix is reverted.
2. **Noisy logging.** glTF-Transform printed `prune: Removed types...` per model, twelve times in a set build. The shared `io` now logs warnings only.
3. **Missing input file.** A bad `--in` path printed a raw Node stack trace. `main` now prints `cannot open <path>: no such file or directory` and exits 1.
4. **Expected validator warning.** Rigged output carries `NODE_SKINNED_MESH_NON_ROOT`, because the wrapper node scales the joints, which is how the glTF spec drives a skinned mesh. Three's loader agrees (the rigged-king test measures the base at y = 0 and height 1.0). Documented in the README.
5. **Test counts** in Tasks 4, 6, 7, 8 and 9 were corrected to the real numbers.

## Done Criteria for Plan 3

- `pnpm test` (296 tests: Plan 2's 208 plus 88 new), `pnpm typecheck`, `pnpm build` and `pnpm e2e` (unchanged at 9 tests, because `public/packs/` is untouched) all pass. `pnpm dev-packs` still regenerates byte-identical files.
- `pnpm art normalize` turns a fixture model into one that three's `GLTFLoader` reads with its base on y = 0, centered, at the spec height, with exactly the requested clips.
- `pnpm art build-set` builds twelve models plus a manifest that `parseSetManifest` accepts, and `pnpm dev-packs` refuses to overwrite it.
- The tools reject, with the piece key in the message: Z-up models, far-off-center models, clips outside the standard five, missing listed clips, mismatched rigs, oversize files.
- No test calls the network or reads an API key.

## Deferred and Plan 3b

Plan 3b is the live generation. Each item needs a decision or a key from the project owner, so none of it is in this plan:

- **Concept images** (`generate-concepts.ts`): which image model to use, and the prompt template per piece type. Meshy can also generate a model from text alone, which would skip this step.
- **Meshy clients** (`generate-models.ts`, `rig-models.ts`, plus a new animation step). Facts taken from Meshy's current docs:
  - Image-to-3D is `POST /openapi/v1/image-to-3d` (Bearer token; `image_url`, `target_polycount`, `should_texture`, `pose_mode`, and others). Tasks are polled for `SUCCEEDED`; the result has `model_urls.glb`.
  - Rigging is `POST /openapi/v1/rigging`. It needs a textured GLB that faces +Z, at most 300,000 faces, and a humanoid with clear limbs. It returns the rigged model plus **only walking and running clips**.
  - Attack, hit, die, victory and idle come from a separate `POST /openapi/v1/animations` (one `action_id` per clip, one glb per action, `rig_task_id` from the rigging task). Action ids are looked up for free with `GET /openapi/v1/animations/library`. Task 5's `mergeClips` exists for exactly this.
  - Rough credit cost, from the docs' own examples and to be re-checked before spending: 5 per rigging task and 3 per animation, so about 20 per rigged piece for rigging plus five clips, before image-to-3D generation and retries. Eight rigged pieces at two or three attempts each is a few hundred credits.
- **Knight rigging.** Meshy's rigging does not support non-humanoid models. A horse-shaped knight will fail. The spec says non-humanoid designs stay rigid, so the decision is either a humanoid knight (a mounted-less knight-in-armor) or a rigid knight, which changes the spec's list of eight rigged pieces to six.
- **Audio.** Real `attack`, `hit` and `die` sounds as `.ogg` (or keep `.wav`; manifest paths are free-form). Sourcing and licensing are a human decision. `build-set` already copies whatever `set.json` lists.
- **Board art.** `board.glb` must keep a mesh named `cracks` with UVs spanning the board for the lava shader, and `env.hdr`. Nothing in this plan builds those.
- **Smaller items carried over from Plan 2:** `preview.png` for each pack, the bloom quality auto-switch, and whether to self-host the Draco decoder or add mesh compression to the normalizer (Decision 6).

## Risks

- **Real Meshy output is untested.** Every test uses in-memory statues. The first real rigged model may expose an assumption (a joint hierarchy with its own scale, a texture that is not opaque, an armature node with a different name in the animation files). Task 5's name matching and the warnings are the early signs. Run `pnpm art normalize` on a single real piece and look at it in the app before generating all twelve.
- **Alpha is dropped** by the JPEG re-encode (Decision 5). If a generated model needs transparency, `slim` needs a per-texture format choice.
- **Facing must be set by eye** (Decision 2). A wrong `rotateY` shows up as a piece lunging backward in a capture cinematic.
