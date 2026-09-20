# Playable Core Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app where a human plays a full legal game of chess against Stockfish on a 3D board with placeholder pieces, with undo, promotion, difficulty, and game-over detection.

**Architecture:** A pure TypeScript game core wraps chess.js. A Stockfish WebAssembly worker is wrapped behind a promise-based `Engine` interface. A Zustand vanilla store implements the controller state machine and is the only thing that mutates game state. A React Three Fiber scene and a React overlay both subscribe to that store. Content packs, real models, and cinematics come in Plan 2; this plan uses primitive geometry and instant moves, but routes every move through the same `animatingMove` and `cinematic` phases so Plan 2 only swaps the presentation.

**Tech Stack:** TypeScript (strict), Vite, React 19, React Three Fiber, `@react-three/drei`, chess.js, stockfish (npm, single-threaded WASM build), Zustand, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-19-3d-chess-simulator-design.md` (sections 4.1 to 4.4, 8, 10, 11, 13)

**Follow-on plans:** Plan 2 (packs, sequencer, cinematics, lava board), Plan 3 (art pipeline). Interfaces in this plan that those plans depend on are marked **Produces** in each task.

## Global Constraints

- Node 20 or newer. Package manager is pnpm.
- TypeScript strict mode everywhere, including tests.
- Game core has no React, Three.js, or DOM imports.
- Controller is the only code that calls `GameCore.move`.
- Clicks are ignored in `promoting` (except the overlay), `engineThinking`, `animatingMove`, and `cinematic`.
- One square is 1.0 world units wide. Board is centered at the origin; `a1` is at x = -3.5, z = 3.5 (white's side is +z); `h8` is at x = 3.5, z = -3.5.
- Piece heights (used for placeholders and later models): king 1.0, queen 0.9, bishop and knight 0.75, rook 0.7, pawn 0.55.
- Square colors from the spec board manifest: light `#8c8378`, dark `#3b3733`, highlight `#ffd66b`, capture `#ff5a3c`.
- Difficulty slider 1 to 20 maps directly to UCI `Skill Level`. Engine move time capped at 2000 ms.
- Stockfish worker must be ready within 10 000 ms or `ready()` rejects.
- Settings persist to localStorage under the key `chess3d.settings`.
- Commit after every task with a conventional-commit message.

---

## File Structure

```
package.json, pnpm-lock.yaml, tsconfig.json, vite.config.ts, vitest.config.ts,
playwright.config.ts, index.html, .env.example
scripts/
  copy-stockfish.mjs            copies the stockfish wasm build into public/stockfish/
public/stockfish/               (generated, gitignored) stockfish js + wasm
src/
  main.tsx                      mounts <App/>
  App.tsx                       Canvas + overlay
  core/
    types.ts                    Square, Piece, MoveRequest, MoveResult, GameOverReason, PieceId
    squares.ts                  square <-> file/rank <-> world position helpers
    gameCore.ts                 createGameCore(): GameCore  (chess.js wrapper)
    gameCore.test.ts
    squares.test.ts
  engine/
    engine.ts                   createEngine(workerFactory): Engine  (UCI over a Worker)
    engine.test.ts              uses a FakeWorker
    stockfishWorker.ts          real worker factory (one constant: the public URL)
  controller/
    store.ts                    createController(deps): ControllerStore (Zustand vanilla)
    pieceTracker.ts             assigns and moves PieceIds in response to MoveResults
    pieceTracker.test.ts
    store.test.ts
    settings.ts                 load/save settings to localStorage
    settings.test.ts
    context.tsx                 React context + hooks: useController(selector), useActions()
  scene/
    Scene.tsx                   lights, camera rig, board, pieces
    Board.tsx                   64 square meshes with highlight state, click handling
    Pieces.tsx                  maps store.pieces to PlaceholderPiece
    PlaceholderPiece.tsx        capsule/box/cone by type, positioned by square
    CameraRig.tsx               OrbitControls with limits + reset
    animationBridge.ts          after a move lands, calls actions.animationDone() (Plan 2 replaces with the sequencer)
  ui/
    Overlay.tsx                 TopBar, MoveList, SettingsDrawer, GameOverBanner, PromotionDialog
    TopBar.tsx
    MoveList.tsx
    SettingsDrawer.tsx
    GameOverBanner.tsx
    PromotionDialog.tsx         HTML version; Plan 2 adds the in-scene 3D version
    overlay.css
e2e/
  smoke.spec.ts                 Playwright: app mounts, a move can be made
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a working `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm typecheck`.

- [ ] **Step 1: Initialize the package**

```bash
cd /Users/kyler_king/code/3dchess_sim
pnpm init
pnpm add react@^19 react-dom@^19 three @react-three/fiber @react-three/drei chess.js zustand stockfish
pnpm add -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom @types/three @playwright/test
```

- [ ] **Step 2: Write config files**

`package.json` scripts block (merge into the generated file):

```json
{
  "name": "chess3d",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "e2e": "playwright test",
    "postinstall": "node scripts/copy-stockfish.mjs"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "e2e", "scripts", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

`src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chess 3D</title>
    <style>html, body, #root { margin: 0; height: 100%; background: #0b0b0e; overflow: hidden; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`scripts/copy-stockfish.mjs` (a stub for now; Task 3 fills it in):

```js
// Filled in by Task 4.
```

`.env.example`:

```
# No secrets are needed for Plan 1. Plan 3 adds MESHY_API_KEY.
```

Append to `.gitignore`:

```
public/stockfish/
test-results/
playwright-report/
```

- [ ] **Step 3: Write the failing smoke test**

`src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the app title', () => {
  render(<App />);
  expect(screen.getByText('Chess 3D')).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test`
Expected: FAIL, `Cannot find module './App'`

- [ ] **Step 5: Write the minimal App**

`src/App.tsx`:

```tsx
export function App() {
  return <h1>Chess 3D</h1>;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 1 test passes, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite react typescript project with vitest"
```

---

### Task 2: Core types and square geometry helpers

**Files:**
- Create: `src/core/types.ts`, `src/core/squares.ts`, `src/core/squares.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `Square`, `File`, `Rank`, `PieceType`, `Color`, `Piece`, `MoveRequest`, `MoveResult`, `GameOverReason`, `PieceId`, `PromotionPiece`
  - `ALL_SQUARES: readonly Square[]`
  - `fileOf(sq: Square): File`, `rankOf(sq: Square): Rank`, `makeSquare(file: File, rank: Rank): Square`
  - `squareToWorld(sq: Square): { x: number; z: number }` and `isDarkSquare(sq: Square): boolean`
  - `PIECE_HEIGHT: Record<PieceType, number>`

- [ ] **Step 1: Write the types**

`src/core/types.ts`:

```ts
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'w' | 'b';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface MoveRequest {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export type GameOverReason = 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty-move';

export interface MoveResult {
  from: Square;
  to: Square;
  piece: Piece;
  /** Present on any capture. `square` differs from `to` on en passant. */
  captured?: { piece: Piece; square: Square };
  castle?: { rookFrom: Square; rookTo: Square };
  promotion?: PromotionPiece;
  san: string;
  check: boolean;
  gameOver?: GameOverReason;
}

/** Stable identity for a piece across moves, assigned by the controller. */
export type PieceId = string;

export const PIECE_HEIGHT: Record<PieceType, number> = {
  k: 1.0,
  q: 0.9,
  b: 0.75,
  n: 0.75,
  r: 0.7,
  p: 0.55,
};
```

- [ ] **Step 2: Write the failing squares test**

`src/core/squares.test.ts`:

```ts
import { ALL_SQUARES, fileOf, isDarkSquare, makeSquare, rankOf, squareToWorld } from './squares';

test('ALL_SQUARES has 64 unique entries starting at a1 and ending at h8', () => {
  expect(ALL_SQUARES).toHaveLength(64);
  expect(new Set(ALL_SQUARES).size).toBe(64);
  expect(ALL_SQUARES[0]).toBe('a1');
  expect(ALL_SQUARES[63]).toBe('h8');
});

test('fileOf, rankOf, makeSquare round-trip', () => {
  expect(fileOf('e4')).toBe('e');
  expect(rankOf('e4')).toBe('4');
  expect(makeSquare('e', '4')).toBe('e4');
});

test('squareToWorld maps corners with white on +z', () => {
  expect(squareToWorld('a1')).toEqual({ x: -3.5, z: 3.5 });
  expect(squareToWorld('h8')).toEqual({ x: 3.5, z: -3.5 });
  expect(squareToWorld('e4')).toEqual({ x: 0.5, z: 0.5 });
});

test('isDarkSquare: a1 is dark, h1 is light', () => {
  expect(isDarkSquare('a1')).toBe(true);
  expect(isDarkSquare('h1')).toBe(false);
  expect(isDarkSquare('a8')).toBe(false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/core/squares.test.ts`
Expected: FAIL, `Cannot find module './squares'`

- [ ] **Step 4: Implement squares.ts**

`src/core/squares.ts`:

```ts
import type { File, Rank, Square } from './types';

export const FILES: readonly File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS: readonly Rank[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const ALL_SQUARES: readonly Square[] = RANKS.flatMap((r) => FILES.map((f) => `${f}${r}` as Square));

export function fileOf(sq: Square): File {
  return sq[0] as File;
}

export function rankOf(sq: Square): Rank {
  return sq[1] as Rank;
}

export function makeSquare(file: File, rank: Rank): Square {
  return `${file}${rank}`;
}

export function fileIndex(sq: Square): number {
  return FILES.indexOf(fileOf(sq));
}

export function rankIndex(sq: Square): number {
  return RANKS.indexOf(rankOf(sq));
}

/** Board centered at origin, one unit per square, white's side toward +z. */
export function squareToWorld(sq: Square): { x: number; z: number } {
  return { x: fileIndex(sq) - 3.5, z: 3.5 - rankIndex(sq) };
}

export function isDarkSquare(sq: Square): boolean {
  return (fileIndex(sq) + rankIndex(sq)) % 2 === 0;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test src/core/squares.test.ts && pnpm typecheck`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core
git commit -m "feat(core): add shared types and square geometry helpers"
```

---

### Task 3: Game core (chess.js wrapper)

**Files:**
- Create: `src/core/gameCore.ts`, `src/core/gameCore.test.ts`

**Interfaces:**
- Consumes: everything from `src/core/types.ts` and `makeSquare`, `fileOf`, `rankOf` from `src/core/squares.ts`.
- Produces:

```ts
export interface GameCore {
  fen(): string;
  turn(): Color;
  pieceAt(square: Square): Piece | null;
  legalMoves(from: Square): Square[];
  needsPromotion(from: Square, to: Square): boolean;
  move(req: MoveRequest): MoveResult;   // throws Error('Illegal move ...') on illegal
  undo(): MoveResult | null;
  history(): readonly MoveResult[];
  inCheck(): boolean;
  gameOver(): GameOverReason | null;
  reset(): void;
}
export function createGameCore(fen?: string): GameCore;
```

Reference for the implementer: chess.js v1 `move()` throws on illegal moves and returns a `Move` with `flags` containing `e` (en passant), `k` (kingside castle), `q` (queenside castle), `c` (capture), `p` (promotion). `get(square)` returns `undefined` for empty squares. Draw detection: `isInsufficientMaterial()`, `isThreefoldRepetition()`, and `isDraw()` (which also covers the fifty-move rule).

- [ ] **Step 1: Write the failing tests**

`src/core/gameCore.test.ts`:

```ts
import { createGameCore } from './gameCore';

describe('createGameCore', () => {
  test('start position: white to move, e2 pawn has two legal moves', () => {
    const g = createGameCore();
    expect(g.turn()).toBe('w');
    expect(g.pieceAt('e2')).toEqual({ type: 'p', color: 'w' });
    expect(g.pieceAt('e4')).toBeNull();
    expect(g.legalMoves('e2').sort()).toEqual(['e3', 'e4']);
    expect(g.legalMoves('e4')).toEqual([]);
    expect(g.gameOver()).toBeNull();
  });

  test('a plain move returns a MoveResult with san and no capture', () => {
    const g = createGameCore();
    const r = g.move({ from: 'e2', to: 'e4' });
    expect(r).toMatchObject({ from: 'e2', to: 'e4', piece: { type: 'p', color: 'w' }, san: 'e4', check: false });
    expect(r.captured).toBeUndefined();
    expect(r.castle).toBeUndefined();
    expect(g.turn()).toBe('b');
    expect(g.history()).toHaveLength(1);
  });

  test('illegal move throws and leaves state untouched', () => {
    const g = createGameCore();
    expect(() => g.move({ from: 'e2', to: 'e5' })).toThrow(/illegal/i);
    expect(g.turn()).toBe('w');
    expect(g.history()).toHaveLength(0);
  });

  test('capture reports the captured piece on the destination square', () => {
    const g = createGameCore();
    g.move({ from: 'e2', to: 'e4' });
    g.move({ from: 'd7', to: 'd5' });
    const r = g.move({ from: 'e4', to: 'd5' });
    expect(r.captured).toEqual({ piece: { type: 'p', color: 'b' }, square: 'd5' });
  });

  test('en passant reports the captured pawn on its own square', () => {
    const g = createGameCore('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    const r = g.move({ from: 'e5', to: 'd6' });
    expect(r.captured).toEqual({ piece: { type: 'p', color: 'b' }, square: 'd5' });
    expect(g.pieceAt('d5')).toBeNull();
  });

  test('castling reports rook movement for both sides', () => {
    const k = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(k.move({ from: 'e1', to: 'g1' }).castle).toEqual({ rookFrom: 'h1', rookTo: 'f1' });
    const q = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(q.move({ from: 'e1', to: 'c1' }).castle).toEqual({ rookFrom: 'a1', rookTo: 'd1' });
    const bq = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1');
    expect(bq.move({ from: 'e8', to: 'c8' }).castle).toEqual({ rookFrom: 'a8', rookTo: 'd8' });
  });

  test('promotion: needsPromotion is true only for a pawn reaching the last rank', () => {
    const g = createGameCore('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.needsPromotion('a7', 'a8')).toBe(true);
    expect(g.needsPromotion('h1', 'h2')).toBe(false);
    const r = g.move({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(r.promotion).toBe('q');
    expect(g.pieceAt('a8')).toEqual({ type: 'q', color: 'w' });
  });

  test("scholar's mate reports check and checkmate", () => {
    const g = createGameCore();
    for (const [from, to] of [['e2','e4'],['e7','e5'],['f1','c4'],['b8','c6'],['d1','h5'],['g8','f6']] as const) {
      g.move({ from, to });
    }
    const r = g.move({ from: 'h5', to: 'f7' });
    expect(r.check).toBe(true);
    expect(r.gameOver).toBe('checkmate');
    expect(g.inCheck()).toBe(true);
    expect(g.gameOver()).toBe('checkmate');
  });

  test('stalemate is reported', () => {
    const g = createGameCore('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    const r = g.move({ from: 'g6', to: 'h6' });
    expect(r.gameOver).toBe('stalemate');
    expect(g.gameOver()).toBe('stalemate');
  });

  test('insufficient material is reported', () => {
    const g = createGameCore('k7/8/8/8/8/8/8/K6N w - - 0 1');
    expect(g.gameOver()).toBe('insufficient');
  });

  test('undo restores the board and returns the undone MoveResult', () => {
    const g = createGameCore();
    g.move({ from: 'e2', to: 'e4' });
    const undone = g.undo();
    expect(undone?.san).toBe('e4');
    expect(g.pieceAt('e2')).toEqual({ type: 'p', color: 'w' });
    expect(g.pieceAt('e4')).toBeNull();
    expect(g.turn()).toBe('w');
    expect(g.history()).toHaveLength(0);
    expect(g.undo()).toBeNull();
  });

  test('reset returns to the start position and clears history', () => {
    const g = createGameCore();
    g.move({ from: 'e2', to: 'e4' });
    g.reset();
    expect(g.fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(g.history()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/core/gameCore.test.ts`
Expected: FAIL, `Cannot find module './gameCore'`

- [ ] **Step 3: Implement gameCore.ts**

`src/core/gameCore.ts`:

```ts
import { Chess, type Move } from 'chess.js';
import type { Color, GameOverReason, MoveRequest, MoveResult, Piece, PromotionPiece, Square } from './types';
import { fileOf, makeSquare, rankOf } from './squares';

export interface GameCore {
  fen(): string;
  turn(): Color;
  pieceAt(square: Square): Piece | null;
  legalMoves(from: Square): Square[];
  needsPromotion(from: Square, to: Square): boolean;
  move(req: MoveRequest): MoveResult;
  undo(): MoveResult | null;
  history(): readonly MoveResult[];
  inCheck(): boolean;
  gameOver(): GameOverReason | null;
  reset(): void;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function createGameCore(fen: string = START_FEN): GameCore {
  const chess = new Chess(fen);
  const results: MoveResult[] = [];

  function gameOver(): GameOverReason | null {
    if (chess.isCheckmate()) return 'checkmate';
    if (chess.isStalemate()) return 'stalemate';
    if (chess.isInsufficientMaterial()) return 'insufficient';
    if (chess.isThreefoldRepetition()) return 'threefold';
    if (chess.isDraw()) return 'fifty-move';
    return null;
  }

  function toResult(m: Move): MoveResult {
    const from = m.from as Square;
    const to = m.to as Square;
    const piece: Piece = { type: m.piece, color: m.color };
    const r: MoveResult = { from, to, piece, san: m.san, check: chess.isCheck() };

    if (m.captured) {
      const square: Square = m.flags.includes('e') ? makeSquare(fileOf(to), rankOf(from)) : to;
      r.captured = { piece: { type: m.captured, color: m.color === 'w' ? 'b' : 'w' }, square };
    }
    if (m.flags.includes('k')) {
      r.castle = { rookFrom: makeSquare('h', rankOf(from)), rookTo: makeSquare('f', rankOf(from)) };
    } else if (m.flags.includes('q')) {
      r.castle = { rookFrom: makeSquare('a', rankOf(from)), rookTo: makeSquare('d', rankOf(from)) };
    }
    if (m.promotion) r.promotion = m.promotion as PromotionPiece;

    const over = gameOver();
    if (over) r.gameOver = over;
    return r;
  }

  function legalMoves(from: Square): Square[] {
    return chess.moves({ square: from, verbose: true }).map((m) => m.to as Square);
  }

  return {
    fen: () => chess.fen(),
    turn: () => chess.turn(),
    pieceAt(square) {
      const p = chess.get(square);
      return p ? { type: p.type, color: p.color } : null;
    },
    legalMoves,
    needsPromotion(from, to) {
      const p = chess.get(from);
      if (!p || p.type !== 'p') return false;
      const lastRank = p.color === 'w' ? '8' : '1';
      return rankOf(to) === lastRank && legalMoves(from).includes(to);
    },
    move(req) {
      let m: Move;
      try {
        m = chess.move({ from: req.from, to: req.to, promotion: req.promotion });
      } catch {
        throw new Error(`Illegal move ${req.from}-${req.to}${req.promotion ?? ''}`);
      }
      const r = toResult(m);
      results.push(r);
      return r;
    },
    undo() {
      const m = chess.undo();
      if (!m) return null;
      return results.pop() ?? null;
    },
    history: () => results,
    inCheck: () => chess.isCheck(),
    gameOver,
    reset() {
      chess.load(START_FEN);
      results.length = 0;
    },
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test src/core && pnpm typecheck`
Expected: all core tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core
git commit -m "feat(core): add GameCore wrapper over chess.js with full rule coverage"
```

---

### Task 4: Engine wrapper (Stockfish over UCI in a worker)

**Files:**
- Create: `src/engine/engine.ts`, `src/engine/engine.test.ts`, `src/engine/stockfishWorker.ts`
- Modify: `scripts/copy-stockfish.mjs`

**Interfaces:**
- Consumes: `MoveRequest`, `Square`, `PromotionPiece` from `src/core/types.ts`.
- Produces:

```ts
export interface EngineWorker {
  postMessage(msg: string): void;
  onmessage: ((ev: { data: string }) => void) | null;
  terminate(): void;
}
export type WorkerFactory = () => EngineWorker;
export interface Engine {
  ready(): Promise<void>;
  setSkill(level: number): void;                       // clamped to 0..20
  bestMove(fen: string, moveTimeMs: number): Promise<MoveRequest>;
  stop(): void;
  dispose(): void;
}
export function createEngine(factory: WorkerFactory, opts?: { readyTimeoutMs?: number }): Engine;
export const stockfishWorkerFactory: WorkerFactory;   // from stockfishWorker.ts
```

Protocol: on creation post `uci`, wait for `uciok`, post `isready`, wait for `readyok`, resolve `ready()`. `bestMove` posts `position fen <fen>` then `go movetime <ms>` and resolves on the first line starting with `bestmove`. `bestmove (none)` rejects. `stop()` posts `stop` and rejects any pending `bestMove` with an error whose message contains `stopped`. Only one `bestMove` is in flight at a time; a second call while one is pending rejects immediately.

- [ ] **Step 1: Write the failing tests**

`src/engine/engine.test.ts`:

```ts
import { createEngine, type EngineWorker } from './engine';

class FakeWorker implements EngineWorker {
  sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  terminated = false;
  postMessage(msg: string) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line }); }
}

function boot() {
  const w = new FakeWorker();
  const engine = createEngine(() => w, { readyTimeoutMs: 10_000 });
  return { w, engine };
}

async function bootReady() {
  const { w, engine } = boot();
  const ready = engine.ready();
  w.emit('uciok');
  w.emit('readyok');
  await ready;
  return { w, engine };
}

describe('createEngine', () => {
  test('handshake: posts uci, then isready after uciok, resolves ready on readyok', async () => {
    const { w, engine } = boot();
    const ready = engine.ready();
    expect(w.sent).toEqual(['uci']);
    w.emit('id name Stockfish 16');
    w.emit('uciok');
    expect(w.sent).toEqual(['uci', 'isready']);
    w.emit('readyok');
    await expect(ready).resolves.toBeUndefined();
  });

  test('ready rejects when the handshake exceeds the timeout', async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const engine = createEngine(() => w, { readyTimeoutMs: 500 });
    const ready = engine.ready();
    vi.advanceTimersByTime(501);
    await expect(ready).rejects.toThrow(/timed out/i);
    vi.useRealTimers();
  });

  test('setSkill posts the UCI option, clamped to 0..20', async () => {
    const { w, engine } = await bootReady();
    engine.setSkill(7);
    engine.setSkill(99);
    engine.setSkill(-3);
    expect(w.sent.slice(-3)).toEqual([
      'setoption name Skill Level value 7',
      'setoption name Skill Level value 20',
      'setoption name Skill Level value 0',
    ]);
  });

  test('bestMove posts position and go, parses a plain move', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('startfen', 1500);
    expect(w.sent.slice(-2)).toEqual(['position fen startfen', 'go movetime 1500']);
    w.emit('info depth 1 score cp 20');
    w.emit('bestmove e2e4 ponder e7e5');
    await expect(p).resolves.toEqual({ from: 'e2', to: 'e4' });
  });

  test('bestMove parses a promotion', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('f', 100);
    w.emit('bestmove a7a8q');
    await expect(p).resolves.toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  test('bestmove (none) rejects', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('f', 100);
    w.emit('bestmove (none)');
    await expect(p).rejects.toThrow(/no move/i);
  });

  test('stop posts stop and rejects the pending bestMove', async () => {
    const { w, engine } = await bootReady();
    const p = engine.bestMove('f', 100);
    engine.stop();
    expect(w.sent.at(-1)).toBe('stop');
    await expect(p).rejects.toThrow(/stopped/i);
  });

  test('a second bestMove while one is pending rejects', async () => {
    const { w, engine } = await bootReady();
    const first = engine.bestMove('f', 100);
    await expect(engine.bestMove('f', 100)).rejects.toThrow(/pending/i);
    w.emit('bestmove e2e4');
    await first;
  });

  test('dispose terminates the worker', async () => {
    const { w, engine } = await bootReady();
    engine.dispose();
    expect(w.terminated).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/engine`
Expected: FAIL, `Cannot find module './engine'`

- [ ] **Step 3: Implement engine.ts**

`src/engine/engine.ts`:

```ts
import type { MoveRequest, PromotionPiece, Square } from '../core/types';

export interface EngineWorker {
  postMessage(msg: string): void;
  onmessage: ((ev: { data: string }) => void) | null;
  terminate(): void;
}

export type WorkerFactory = () => EngineWorker;

export interface Engine {
  ready(): Promise<void>;
  setSkill(level: number): void;
  bestMove(fen: string, moveTimeMs: number): Promise<MoveRequest>;
  stop(): void;
  dispose(): void;
}

interface Pending {
  resolve: (m: MoveRequest) => void;
  reject: (e: Error) => void;
}

export function parseBestMove(line: string): MoveRequest | null {
  const token = line.split(/\s+/)[1];
  if (!token || token === '(none)') return null;
  const from = token.slice(0, 2) as Square;
  const to = token.slice(2, 4) as Square;
  const promotion = token[4] as PromotionPiece | undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

export function createEngine(factory: WorkerFactory, opts: { readyTimeoutMs?: number } = {}): Engine {
  const readyTimeoutMs = opts.readyTimeoutMs ?? 10_000;
  const worker = factory();
  let pending: Pending | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  readyPromise.catch(() => {}); // avoid unhandled rejection when nobody awaits ready()

  const timer = setTimeout(() => rejectReady(new Error('Engine timed out during UCI handshake')), readyTimeoutMs);

  worker.onmessage = (ev) => {
    const line = String(ev.data);
    if (line === 'uciok') {
      worker.postMessage('isready');
    } else if (line === 'readyok') {
      clearTimeout(timer);
      resolveReady();
    } else if (line.startsWith('bestmove')) {
      const p = pending;
      pending = null;
      if (!p) return;
      const m = parseBestMove(line);
      if (m) p.resolve(m);
      else p.reject(new Error('Engine returned no move'));
    }
  };

  worker.postMessage('uci');

  return {
    ready: () => readyPromise,
    setSkill(level) {
      const clamped = Math.max(0, Math.min(20, Math.round(level)));
      worker.postMessage(`setoption name Skill Level value ${clamped}`);
    },
    bestMove(fen, moveTimeMs) {
      if (pending) return Promise.reject(new Error('A bestMove request is already pending'));
      return new Promise<MoveRequest>((resolve, reject) => {
        pending = { resolve, reject };
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go movetime ${Math.round(moveTimeMs)}`);
      });
    },
    stop() {
      worker.postMessage('stop');
      const p = pending;
      pending = null;
      p?.reject(new Error('Engine search stopped'));
    },
    dispose() {
      clearTimeout(timer);
      pending?.reject(new Error('Engine disposed (stopped)'));
      pending = null;
      worker.terminate();
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/engine`
Expected: 9 tests pass.

- [ ] **Step 5: Write the real worker factory and the copy script**

`src/engine/stockfishWorker.ts`:

```ts
import type { EngineWorker, WorkerFactory } from './engine';

/**
 * Served from public/stockfish/, populated by scripts/copy-stockfish.mjs on install.
 * If that script logs a different file name for your installed stockfish version,
 * update this constant to match.
 */
export const STOCKFISH_URL = '/stockfish/stockfish-nnue-16-single.js';

export const stockfishWorkerFactory: WorkerFactory = () => {
  const w = new Worker(STOCKFISH_URL);
  return w as unknown as EngineWorker;
};
```

`scripts/copy-stockfish.mjs`:

```js
// Copies the single-threaded Stockfish WASM build into public/stockfish/ so it can be
// loaded as a classic Worker without cross-origin isolation headers.
import { mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', 'stockfish', 'src');
const dest = join(root, 'public', 'stockfish');

if (!existsSync(src)) {
  console.warn('[copy-stockfish] node_modules/stockfish/src not found; skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
const files = readdirSync(src).filter((f) => f.includes('-single') && (f.endsWith('.js') || f.endsWith('.wasm')));
if (files.length === 0) {
  console.error('[copy-stockfish] no single-threaded build found in', src, '\nContents:', readdirSync(src));
  process.exit(1);
}
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log('[copy-stockfish] copied:', files.join(', '));
```

- [ ] **Step 6: Run the copy script and confirm the file name matches the constant**

Run: `node scripts/copy-stockfish.mjs && ls public/stockfish`
Expected: a `.js` and a `.wasm` file. If the `.js` name is not `stockfish-nnue-16-single.js`, change `STOCKFISH_URL` to the printed name.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add src/engine scripts/copy-stockfish.mjs
git commit -m "feat(engine): add UCI engine wrapper with worker factory and stockfish copy script"
```

---

### Task 5: Piece tracker (stable piece ids across moves)

**Files:**
- Create: `src/controller/pieceTracker.ts`, `src/controller/pieceTracker.test.ts`

**Interfaces:**
- Consumes: `GameCore` (for `pieceAt`), `ALL_SQUARES`, `MoveResult`, `PieceId`, `Piece`, `Square`.
- Produces:

```ts
export interface PlacedPiece {
  square: Square;
  piece: Piece;
  captured: boolean;
  capturedAtPly?: number;   // ply index of the move that captured it
}
export type PieceMap = Record<PieceId, PlacedPiece>;
export function initialPieces(core: GameCore): PieceMap;           // ids look like "w-p-3"
export function pieceIdAt(pieces: PieceMap, square: Square): PieceId | null;   // ignores captured
export function applyMove(pieces: PieceMap, r: MoveResult, ply: number): PieceMap;
export function revertMove(pieces: PieceMap, r: MoveResult, ply: number): PieceMap;
```

Captured pieces stay in the map with `captured: true` so undo can bring them back and so Plan 2 can animate them out before removal. Functions are pure and return a new object.

- [ ] **Step 1: Write the failing tests**

`src/controller/pieceTracker.test.ts`:

```ts
import { createGameCore } from '../core/gameCore';
import { applyMove, initialPieces, pieceIdAt, revertMove, type PieceMap } from './pieceTracker';

function live(pieces: PieceMap) {
  return Object.values(pieces).filter((p) => !p.captured).length;
}

test('initialPieces creates 32 pieces with deterministic ids', () => {
  const pieces = initialPieces(createGameCore());
  expect(Object.keys(pieces)).toHaveLength(32);
  expect(pieces['w-k-0']).toEqual({ square: 'e1', piece: { type: 'k', color: 'w' }, captured: false });
  expect(pieces['b-p-7']?.square).toBe('h7');
  expect(pieceIdAt(pieces, 'a1')).toBe('w-r-0');
  expect(pieceIdAt(pieces, 'e4')).toBeNull();
});

test('applyMove moves the piece and keeps its id', () => {
  const core = createGameCore();
  const p0 = initialPieces(core);
  const id = pieceIdAt(p0, 'e2')!;
  const r = core.move({ from: 'e2', to: 'e4' });
  const p1 = applyMove(p0, r, 0);
  expect(p1[id]?.square).toBe('e4');
  expect(pieceIdAt(p1, 'e2')).toBeNull();
  expect(p0[id]?.square).toBe('e2'); // pure
});

test('applyMove marks captured pieces and revertMove restores them', () => {
  const core = createGameCore();
  let pieces = initialPieces(core);
  const r1 = core.move({ from: 'e2', to: 'e4' }); pieces = applyMove(pieces, r1, 0);
  const r2 = core.move({ from: 'd7', to: 'd5' }); pieces = applyMove(pieces, r2, 1);
  const victim = pieceIdAt(pieces, 'd5')!;
  const r3 = core.move({ from: 'e4', to: 'd5' }); pieces = applyMove(pieces, r3, 2);
  expect(pieces[victim]).toMatchObject({ captured: true, capturedAtPly: 2 });
  expect(live(pieces)).toBe(31);
  expect(pieceIdAt(pieces, 'd5')).toBe('w-p-4');

  pieces = revertMove(pieces, r3, 2);
  expect(pieces[victim]).toEqual({ square: 'd5', piece: { type: 'p', color: 'b' }, captured: false });
  expect(pieceIdAt(pieces, 'e4')).toBe('w-p-4');
  expect(live(pieces)).toBe(32);
});

test('en passant removes the pawn on its own square', () => {
  const core = createGameCore('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  let pieces = initialPieces(core);
  const victim = pieceIdAt(pieces, 'd5')!;
  const r = core.move({ from: 'e5', to: 'd6' });
  pieces = applyMove(pieces, r, 0);
  expect(pieces[victim]?.captured).toBe(true);
  expect(pieceIdAt(pieces, 'd6')).not.toBeNull();
});

test('castling moves the rook too, and revert moves it back', () => {
  const core = createGameCore('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  let pieces = initialPieces(core);
  const rook = pieceIdAt(pieces, 'h1')!;
  const r = core.move({ from: 'e1', to: 'g1' });
  pieces = applyMove(pieces, r, 0);
  expect(pieces[rook]?.square).toBe('f1');
  pieces = revertMove(pieces, r, 0);
  expect(pieces[rook]?.square).toBe('h1');
});

test('promotion changes the piece type, revert restores the pawn', () => {
  const core = createGameCore('8/P7/8/8/8/8/8/k6K w - - 0 1');
  let pieces = initialPieces(core);
  const pawn = pieceIdAt(pieces, 'a7')!;
  const r = core.move({ from: 'a7', to: 'a8', promotion: 'q' });
  pieces = applyMove(pieces, r, 0);
  expect(pieces[pawn]?.piece).toEqual({ type: 'q', color: 'w' });
  pieces = revertMove(pieces, r, 0);
  expect(pieces[pawn]?.piece).toEqual({ type: 'p', color: 'w' });
  expect(pieces[pawn]?.square).toBe('a7');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/controller/pieceTracker.test.ts`
Expected: FAIL, `Cannot find module './pieceTracker'`

- [ ] **Step 3: Implement pieceTracker.ts**

`src/controller/pieceTracker.ts`:

```ts
import type { GameCore } from '../core/gameCore';
import { ALL_SQUARES } from '../core/squares';
import type { MoveResult, Piece, PieceId, Square } from '../core/types';

export interface PlacedPiece {
  square: Square;
  piece: Piece;
  captured: boolean;
  capturedAtPly?: number;
}

export type PieceMap = Record<PieceId, PlacedPiece>;

export function initialPieces(core: GameCore): PieceMap {
  const counts: Record<string, number> = {};
  const pieces: PieceMap = {};
  for (const square of ALL_SQUARES) {
    const piece = core.pieceAt(square);
    if (!piece) continue;
    const key = `${piece.color}-${piece.type}`;
    const n = counts[key] ?? 0;
    counts[key] = n + 1;
    pieces[`${key}-${n}`] = { square, piece, captured: false };
  }
  return pieces;
}

export function pieceIdAt(pieces: PieceMap, square: Square): PieceId | null {
  for (const [id, p] of Object.entries(pieces)) {
    if (!p.captured && p.square === square) return id;
  }
  return null;
}

function mustFind(pieces: PieceMap, square: Square): PieceId {
  const id = pieceIdAt(pieces, square);
  if (!id) throw new Error(`No live piece on ${square}`);
  return id;
}

export function applyMove(pieces: PieceMap, r: MoveResult, ply: number): PieceMap {
  const next: PieceMap = { ...pieces };
  if (r.captured) {
    const victim = mustFind(next, r.captured.square);
    next[victim] = { ...next[victim]!, captured: true, capturedAtPly: ply };
  }
  const mover = mustFind(next, r.from);
  next[mover] = {
    ...next[mover]!,
    square: r.to,
    piece: r.promotion ? { ...next[mover]!.piece, type: r.promotion } : next[mover]!.piece,
  };
  if (r.castle) {
    const rook = mustFind(next, r.castle.rookFrom);
    next[rook] = { ...next[rook]!, square: r.castle.rookTo };
  }
  return next;
}

export function revertMove(pieces: PieceMap, r: MoveResult, ply: number): PieceMap {
  const next: PieceMap = { ...pieces };
  const mover = mustFind(next, r.to);
  next[mover] = {
    ...next[mover]!,
    square: r.from,
    piece: r.promotion ? { ...next[mover]!.piece, type: 'p' } : next[mover]!.piece,
  };
  if (r.castle) {
    const rook = mustFind(next, r.castle.rookTo);
    next[rook] = { ...next[rook]!, square: r.castle.rookFrom };
  }
  if (r.captured) {
    const entry = Object.entries(next).find(([, p]) => p.captured && p.capturedAtPly === ply);
    if (!entry) throw new Error(`No piece captured at ply ${ply} to restore`);
    const [victim, p] = entry;
    next[victim] = { square: r.captured.square, piece: p.piece, captured: false };
  }
  return next;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test src/controller/pieceTracker.test.ts && pnpm typecheck`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/controller/pieceTracker.ts src/controller/pieceTracker.test.ts
git commit -m "feat(controller): add piece tracker with stable ids, capture and undo support"
```

---

### Task 6: Settings persistence

**Files:**
- Create: `src/controller/settings.ts`, `src/controller/settings.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Settings { skill: number; cinematics: boolean; sound: boolean; twoPlayer: boolean; }
export const DEFAULT_SETTINGS: Settings;   // { skill: 5, cinematics: true, sound: true, twoPlayer: false }
export const SETTINGS_KEY = 'chess3d.settings';
export function loadSettings(storage?: Pick<Storage, 'getItem'>): Settings;
export function saveSettings(s: Settings, storage?: Pick<Storage, 'setItem'>): void;
```

Both functions swallow storage errors (private windows, blocked storage) and never throw.

- [ ] **Step 1: Write the failing tests**

`src/controller/settings.test.ts`:

```ts
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from './settings';

beforeEach(() => localStorage.clear());

test('loadSettings returns defaults when nothing is stored', () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test('saveSettings then loadSettings round-trips', () => {
  saveSettings({ skill: 12, cinematics: false, sound: true, twoPlayer: true });
  expect(loadSettings()).toEqual({ skill: 12, cinematics: false, sound: true, twoPlayer: true });
});

test('loadSettings merges partial or malformed stored values with defaults', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ skill: 'high', sound: false }));
  expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, sound: false });
  localStorage.setItem(SETTINGS_KEY, 'not json');
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test('storage errors are swallowed', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/controller/settings.test.ts`
Expected: FAIL, `Cannot find module './settings'`

- [ ] **Step 3: Implement settings.ts**

`src/controller/settings.ts`:

```ts
export interface Settings {
  skill: number;
  cinematics: boolean;
  sound: boolean;
  twoPlayer: boolean;
}

export const DEFAULT_SETTINGS: Settings = { skill: 5, cinematics: true, sound: true, twoPlayer: false };
export const SETTINGS_KEY = 'chess3d.settings';

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
    const p = parsed as Record<string, unknown>;
    return {
      skill: typeof p.skill === 'number' ? Math.max(1, Math.min(20, p.skill)) : DEFAULT_SETTINGS.skill,
      cinematics: typeof p.cinematics === 'boolean' ? p.cinematics : DEFAULT_SETTINGS.cinematics,
      sound: typeof p.sound === 'boolean' ? p.sound : DEFAULT_SETTINGS.sound,
      twoPlayer: typeof p.twoPlayer === 'boolean' ? p.twoPlayer : DEFAULT_SETTINGS.twoPlayer,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable; settings simply won't persist
  }
}
```

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test src/controller/settings.test.ts && pnpm typecheck`
Expected: 4 tests pass.

```bash
git add src/controller/settings.ts src/controller/settings.test.ts
git commit -m "feat(controller): add settings load/save with localStorage fallback"
```

---

### Task 7: Controller store (state machine)

**Files:**
- Create: `src/controller/store.ts`, `src/controller/store.test.ts`

**Interfaces:**
- Consumes: `GameCore` (Task 3), `Engine` (Task 4), `initialPieces`, `applyMove`, `revertMove`, `PieceMap` (Task 5), `Settings`, `DEFAULT_SETTINGS`, `saveSettings` (Task 6).
- Produces (used by the scene and UI):

```ts
export type Phase = 'idle' | 'selected' | 'promoting' | 'engineThinking' | 'animatingMove' | 'cinematic' | 'gameOver';
export type EngineStatus = 'none' | 'starting' | 'ready' | 'failed';

export interface ControllerState {
  phase: Phase;
  pieces: PieceMap;
  selected: Square | null;
  legalTargets: Square[];
  lastMove: MoveResult | null;
  history: MoveResult[];
  pendingPromotion: { from: Square; to: Square } | null;
  turn: Color;
  inCheck: boolean;
  gameOver: GameOverReason | null;
  settings: Settings;
  engineStatus: EngineStatus;
  engineError: string | null;
}

export interface ControllerActions {
  clickSquare(sq: Square): void;
  choosePromotion(p: PromotionPiece): void;
  cancelPromotion(): void;
  skipCinematic(): void;
  undo(): void;
  newGame(): void;
  updateSettings(patch: Partial<Settings>): void;
  animationDone(): void;
}

export interface ControllerDeps {
  core: GameCore;
  engine?: Engine | null;
  settings?: Settings;
  saveSettings?: (s: Settings) => void;
  humanColor?: Color;        // default 'w'
  moveTimeMs?: number;       // default 1500, capped at 2000
}

export type ControllerStore = StoreApi<ControllerState & { actions: ControllerActions }>;
export function createController(deps: ControllerDeps): ControllerStore;
```

Behavior rules (all tested below):

- Human plays `humanColor`; the engine plays the other side unless `settings.twoPlayer`, in which case clicks move both sides and the engine is never asked.
- Every move (human or engine) enters `cinematic` if it captured and cinematics are on, otherwise `animatingMove`. `animationDone()` (or `skipCinematic()` in `cinematic`) then routes to `gameOver`, `engineThinking`, or `idle`.
- Engine results are tagged with a request sequence number; results arriving after `undo` or `newGame` are discarded.
- A rejected engine search whose message contains `stopped` is ignored. Any other rejection is retried once, then the engine is marked `failed`, `twoPlayer` is switched on and saved, and the phase returns to `idle`.
- `undo` in `engineThinking` stops the engine and undoes one move. Elsewhere it undoes one move, then a second if it is then not the human's turn (so a human-plus-engine pair is undone together). `undo` is ignored in `promoting`, `animatingMove`, `cinematic`.
- `updateSettings` saves, forwards `skill` to the engine when ready, and if `twoPlayer` was just turned off while idle on the engine's turn, starts the engine.

- [ ] **Step 1: Write the failing tests**

`src/controller/store.test.ts`:

```ts
import { createGameCore } from '../core/gameCore';
import type { Engine } from '../engine/engine';
import type { MoveRequest } from '../core/types';
import { DEFAULT_SETTINGS } from './settings';
import { createController, type ControllerStore } from './store';
import { pieceIdAt } from './pieceTracker';

class FakeEngine implements Engine {
  skill: number | null = null;
  stops = 0;
  searches: string[] = [];
  private pending: { res: (m: MoveRequest) => void; rej: (e: Error) => void } | null = null;
  private readyRes!: () => void;
  private readyRej!: (e: Error) => void;
  private readyP = new Promise<void>((res, rej) => { this.readyRes = res; this.readyRej = rej; });
  ready() { return this.readyP; }
  becomeReady() { this.readyRes(); }
  failToStart() { this.readyRej(new Error('boom')); }
  setSkill(l: number) { this.skill = l; }
  bestMove(fen: string) {
    this.searches.push(fen);
    return new Promise<MoveRequest>((res, rej) => { this.pending = { res, rej }; });
  }
  reply(m: MoveRequest) { const p = this.pending; this.pending = null; p?.res(m); }
  fail(msg = 'engine crashed') { const p = this.pending; this.pending = null; p?.rej(new Error(msg)); }
  stop() { this.stops++; const p = this.pending; this.pending = null; p?.rej(new Error('Engine search stopped')); }
  dispose() {}
  get isSearching() { return this.pending !== null; }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function setup(fen?: string, settings = { ...DEFAULT_SETTINGS }) {
  const core = createGameCore(fen);
  const engine = new FakeEngine();
  const saved: unknown[] = [];
  const store = createController({ core, engine, settings, saveSettings: (s) => saved.push(s) });
  engine.becomeReady();
  await flush();
  return { core, engine, store, saved, a: store.getState().actions };
}

function state(store: ControllerStore) { return store.getState(); }

describe('createController', () => {
  test('initial state and engine readiness', async () => {
    const { store, engine } = await setup();
    expect(state(store).phase).toBe('idle');
    expect(Object.keys(state(store).pieces)).toHaveLength(32);
    expect(state(store).turn).toBe('w');
    expect(state(store).engineStatus).toBe('ready');
    expect(engine.skill).toBe(DEFAULT_SETTINGS.skill);
  });

  test('selection: own piece selects, same square deselects, other own piece reselects, illegal clears', async () => {
    const { store, a } = await setup();
    a.clickSquare('e2');
    expect(state(store)).toMatchObject({ phase: 'selected', selected: 'e2' });
    expect(state(store).legalTargets.sort()).toEqual(['e3', 'e4']);
    a.clickSquare('e2');
    expect(state(store)).toMatchObject({ phase: 'idle', selected: null, legalTargets: [] });
    a.clickSquare('d2');
    a.clickSquare('g1');
    expect(state(store)).toMatchObject({ phase: 'selected', selected: 'g1' });
    a.clickSquare('h5');
    expect(state(store).phase).toBe('idle');
  });

  test('clicking an opponent piece in idle does nothing', async () => {
    const { store, a } = await setup();
    a.clickSquare('e7');
    expect(state(store).phase).toBe('idle');
  });

  test('full human move then engine reply cycle', async () => {
    const { store, a, engine, core } = await setup();
    const pawn = pieceIdAt(state(store).pieces, 'e2')!;
    a.clickSquare('e2');
    a.clickSquare('e4');
    expect(state(store).phase).toBe('animatingMove');
    expect(state(store).pieces[pawn]?.square).toBe('e4');
    expect(state(store).lastMove?.san).toBe('e4');
    expect(engine.isSearching).toBe(false);

    a.animationDone();
    expect(state(store).phase).toBe('engineThinking');
    expect(engine.searches).toEqual([core.fen()]);

    engine.reply({ from: 'e7', to: 'e5' });
    await flush();
    expect(state(store).phase).toBe('animatingMove');
    expect(state(store).history.map((m) => m.san)).toEqual(['e4', 'e5']);

    a.animationDone();
    expect(state(store).phase).toBe('idle');
    expect(state(store).turn).toBe('w');
  });

  test('captures enter cinematic when enabled and animatingMove when disabled', async () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const on = await setup(fen);
    on.a.clickSquare('e4'); on.a.clickSquare('d5');
    expect(state(on.store).phase).toBe('cinematic');
    on.a.skipCinematic();
    expect(state(on.store).phase).toBe('engineThinking');

    const off = await setup(fen, { ...DEFAULT_SETTINGS, cinematics: false });
    off.a.clickSquare('e4'); off.a.clickSquare('d5');
    expect(state(off.store).phase).toBe('animatingMove');
  });

  test('clicks are ignored while busy', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4');
    a.clickSquare('d2');
    expect(state(store)).toMatchObject({ phase: 'animatingMove', selected: null });
    a.animationDone();
    a.clickSquare('d2');
    expect(state(store)).toMatchObject({ phase: 'engineThinking', selected: null });
    engine.reply({ from: 'e7', to: 'e5' });
    await flush();
    a.animationDone();
    expect(state(store).phase).toBe('idle');
  });

  test('promotion flow: promoting, cancel, choose', async () => {
    const { store, a } = await setup('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const pawn = pieceIdAt(state(store).pieces, 'a7')!;
    a.clickSquare('a7'); a.clickSquare('a8');
    expect(state(store)).toMatchObject({ phase: 'promoting', pendingPromotion: { from: 'a7', to: 'a8' } });
    a.clickSquare('h1');
    expect(state(store).phase).toBe('promoting');
    a.cancelPromotion();
    expect(state(store)).toMatchObject({ phase: 'selected', selected: 'a7', pendingPromotion: null });
    a.clickSquare('a8');
    a.choosePromotion('q');
    expect(state(store).phase).toBe('animatingMove');
    expect(state(store).pieces[pawn]?.piece.type).toBe('q');
  });

  test('checkmate ends the game; newGame resets', async () => {
    const { store, a } = await setup('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    a.clickSquare('h5'); a.clickSquare('f7');
    a.skipCinematic();
    expect(state(store)).toMatchObject({ phase: 'gameOver', gameOver: 'checkmate' });
    a.clickSquare('e2');
    expect(state(store).phase).toBe('gameOver');
    a.newGame();
    expect(state(store)).toMatchObject({ phase: 'idle', gameOver: null, history: [], lastMove: null });
    expect(Object.keys(state(store).pieces)).toHaveLength(32);
  });

  test('undo after an engine reply undoes both moves', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    engine.reply({ from: 'e7', to: 'e5' }); await flush(); a.animationDone();
    a.undo();
    expect(state(store)).toMatchObject({ phase: 'idle', turn: 'w', history: [] });
    expect(pieceIdAt(state(store).pieces, 'e2')).not.toBeNull();
    expect(pieceIdAt(state(store).pieces, 'e7')).not.toBeNull();
  });

  test('undo while the engine thinks stops it and ignores the stale reply', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    expect(state(store).phase).toBe('engineThinking');
    a.undo();
    expect(engine.stops).toBe(1);
    expect(state(store)).toMatchObject({ phase: 'idle', turn: 'w', history: [] });
    await flush();
    expect(state(store).phase).toBe('idle');
  });

  test('engine failing to start enables two-player mode', async () => {
    const core = createGameCore();
    const engine = new FakeEngine();
    const saved: unknown[] = [];
    const store = createController({ core, engine, saveSettings: (s) => saved.push(s) });
    engine.failToStart();
    await flush();
    expect(state(store).engineStatus).toBe('failed');
    expect(state(store).settings.twoPlayer).toBe(true);
    expect(saved).toHaveLength(1);
    const a = state(store).actions;
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    expect(state(store).phase).toBe('idle');
    a.clickSquare('e7'); a.clickSquare('e5'); a.animationDone();
    expect(state(store).phase).toBe('idle');
    expect(engine.searches).toEqual([]);
  });

  test('engine search failure is retried once, then falls back to two-player', async () => {
    const { store, a, engine } = await setup();
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    engine.fail(); await flush();
    expect(state(store).phase).toBe('engineThinking');
    expect(engine.searches).toHaveLength(2);
    engine.fail(); await flush();
    expect(state(store)).toMatchObject({ phase: 'idle', engineStatus: 'failed' });
    expect(state(store).settings.twoPlayer).toBe(true);
  });

  test('updateSettings saves, forwards skill, and wakes the engine when two-player is turned off', async () => {
    const { store, a, engine, saved } = await setup();
    a.updateSettings({ skill: 12 });
    expect(engine.skill).toBe(12);
    expect(saved.at(-1)).toMatchObject({ skill: 12 });
    a.updateSettings({ twoPlayer: true });
    a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
    expect(state(store).phase).toBe('idle');
    a.updateSettings({ twoPlayer: false });
    expect(state(store).phase).toBe('engineThinking');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/controller/store.test.ts`
Expected: FAIL, `Cannot find module './store'`

- [ ] **Step 3: Implement store.ts**

`src/controller/store.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GameCore } from '../core/gameCore';
import type { Engine } from '../engine/engine';
import type { Color, GameOverReason, MoveRequest, MoveResult, PromotionPiece, Square } from '../core/types';
import { applyMove, initialPieces, revertMove, type PieceMap } from './pieceTracker';
import { DEFAULT_SETTINGS, saveSettings as persistSettings, type Settings } from './settings';

export type Phase = 'idle' | 'selected' | 'promoting' | 'engineThinking' | 'animatingMove' | 'cinematic' | 'gameOver';
export type EngineStatus = 'none' | 'starting' | 'ready' | 'failed';

export interface ControllerState {
  phase: Phase;
  pieces: PieceMap;
  selected: Square | null;
  legalTargets: Square[];
  lastMove: MoveResult | null;
  history: MoveResult[];
  pendingPromotion: { from: Square; to: Square } | null;
  turn: Color;
  inCheck: boolean;
  gameOver: GameOverReason | null;
  settings: Settings;
  engineStatus: EngineStatus;
  engineError: string | null;
}

export interface ControllerActions {
  clickSquare(sq: Square): void;
  choosePromotion(p: PromotionPiece): void;
  cancelPromotion(): void;
  skipCinematic(): void;
  undo(): void;
  newGame(): void;
  updateSettings(patch: Partial<Settings>): void;
  animationDone(): void;
}

export interface ControllerDeps {
  core: GameCore;
  engine?: Engine | null;
  settings?: Settings;
  saveSettings?: (s: Settings) => void;
  humanColor?: Color;
  moveTimeMs?: number;
}

export type ControllerStore = StoreApi<ControllerState & { actions: ControllerActions }>;

const CLEAR_SELECTION = { selected: null, legalTargets: [] as Square[], pendingPromotion: null };

export function createController(deps: ControllerDeps): ControllerStore {
  const { core } = deps;
  const engine = deps.engine ?? null;
  const humanColor = deps.humanColor ?? 'w';
  const moveTimeMs = Math.min(2000, deps.moveTimeMs ?? 1500);
  const save = deps.saveSettings ?? persistSettings;
  let requestSeq = 0;
  let retried = false;

  // Declared before the store so helpers can close over it.
  let store: ControllerStore;
  const get = () => store.getState();
  const set = (patch: Partial<ControllerState>) => store.setState(patch);

  const snapshot = () => ({ turn: core.turn(), inCheck: core.inCheck(), gameOver: core.gameOver() });

  const isHumanTurn = () => get().settings.twoPlayer || core.turn() === humanColor;
  const engineShouldMove = () =>
    engine !== null && !get().settings.twoPlayer && get().engineStatus === 'ready' && core.turn() !== humanColor;

  function commitMove(req: MoveRequest) {
    const s = get();
    const ply = s.history.length;
    const r = core.move(req);
    const pieces = applyMove(s.pieces, r, ply);
    const phase: Phase = r.captured && s.settings.cinematics ? 'cinematic' : 'animatingMove';
    set({ pieces, history: [...s.history, r], lastMove: r, phase, ...CLEAR_SELECTION, ...snapshot() });
  }

  /** Spec section 10: an illegal move reaching the core is a bug; log it and return to idle. */
  function safeCommit(req: MoveRequest) {
    try {
      commitMove(req);
    } catch (e) {
      console.error('Illegal move reached the core', req, e);
      set({ phase: 'idle', ...CLEAR_SELECTION });
    }
  }

  function failEngine(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const settings = { ...get().settings, twoPlayer: true };
    save(settings);
    set({ engineStatus: 'failed', engineError: message, settings, phase: 'idle' });
  }

  function requestEngineMove() {
    if (!engine) return set({ phase: 'idle' });
    const seq = ++requestSeq;
    set({ phase: 'engineThinking' });
    engine.bestMove(core.fen(), moveTimeMs).then(
      (req) => {
        if (seq !== requestSeq || get().phase !== 'engineThinking') return;
        retried = false;
        try {
          commitMove(req);
        } catch (e) {
          failEngine(e);
        }
      },
      (err: unknown) => {
        if (seq !== requestSeq) return;
        if (err instanceof Error && /stopped/i.test(err.message)) return;
        if (!retried) {
          retried = true;
          requestEngineMove();
          return;
        }
        failEngine(err);
      },
    );
  }

  function afterMove() {
    const over = core.gameOver();
    if (over) return set({ phase: 'gameOver', gameOver: over });
    if (engineShouldMove()) return requestEngineMove();
    set({ phase: 'idle' });
  }

  function undoOne() {
    const s = get();
    const r = core.undo();
    if (!r) return;
    const ply = s.history.length - 1;
    const history = s.history.slice(0, -1);
    set({ pieces: revertMove(s.pieces, r, ply), history, lastMove: history.at(-1) ?? null });
  }

  const actions: ControllerActions = {
    clickSquare(sq) {
      const s = get();
      if (s.phase !== 'idle' && s.phase !== 'selected') return;
      if (!isHumanTurn()) return;
      if (s.phase === 'selected' && s.selected) {
        if (sq === s.selected) return set({ phase: 'idle', ...CLEAR_SELECTION });
        if (s.legalTargets.includes(sq)) {
          if (core.needsPromotion(s.selected, sq)) {
            return set({ phase: 'promoting', pendingPromotion: { from: s.selected, to: sq } });
          }
          return safeCommit({ from: s.selected, to: sq });
        }
      }
      const piece = core.pieceAt(sq);
      if (piece && piece.color === core.turn()) {
        return set({ phase: 'selected', selected: sq, legalTargets: core.legalMoves(sq), pendingPromotion: null });
      }
      set({ phase: 'idle', ...CLEAR_SELECTION });
    },
    choosePromotion(p) {
      const s = get();
      if (s.phase !== 'promoting' || !s.pendingPromotion) return;
      safeCommit({ ...s.pendingPromotion, promotion: p });
    },
    cancelPromotion() {
      if (get().phase !== 'promoting') return;
      set({ phase: 'selected', pendingPromotion: null });
    },
    animationDone() {
      const p = get().phase;
      if (p !== 'animatingMove' && p !== 'cinematic') return;
      afterMove();
    },
    skipCinematic() {
      if (get().phase !== 'cinematic') return;
      afterMove();
    },
    undo() {
      const p = get().phase;
      if (p === 'promoting' || p === 'animatingMove' || p === 'cinematic') return;
      if (p === 'engineThinking') {
        requestSeq++;
        engine?.stop();
        undoOne();
      } else {
        undoOne();
        if (!get().settings.twoPlayer && core.turn() !== humanColor) undoOne();
      }
      set({ phase: 'idle', ...CLEAR_SELECTION, ...snapshot() });
    },
    newGame() {
      if (get().phase === 'engineThinking') engine?.stop();
      requestSeq++;
      core.reset();
      set({ phase: 'idle', pieces: initialPieces(core), lastMove: null, history: [], ...CLEAR_SELECTION, ...snapshot() });
    },
    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      save(settings);
      set({ settings });
      if (patch.skill !== undefined && engine && get().engineStatus === 'ready') engine.setSkill(patch.skill);
      if (patch.twoPlayer === false && get().phase === 'idle' && engineShouldMove()) requestEngineMove();
    },
  };

  store = createStore<ControllerState & { actions: ControllerActions }>()(() => ({
    phase: 'idle',
    pieces: initialPieces(core),
    lastMove: null,
    history: [],
    ...CLEAR_SELECTION,
    ...snapshot(),
    settings: deps.settings ? { ...deps.settings } : { ...DEFAULT_SETTINGS },
    engineStatus: engine ? 'starting' : 'none',
    engineError: null,
    actions,
  }));

  if (engine) {
    engine.ready().then(
      () => {
        engine.setSkill(get().settings.skill);
        set({ engineStatus: 'ready' });
        if (get().phase === 'idle' && engineShouldMove()) requestEngineMove();
      },
      (err: unknown) => failEngine(err),
    );
  }

  return store;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test src/controller && pnpm typecheck`
Expected: all controller tests pass (store: 13, tracker: 6, settings: 4).

- [ ] **Step 5: Commit**

```bash
git add src/controller/store.ts src/controller/store.test.ts
git commit -m "feat(controller): add state machine store with engine integration, undo, promotion"
```

---

### Task 8: React context and the 3D scene with placeholder pieces

**Files:**
- Create: `src/controller/context.tsx`, `src/scene/Scene.tsx`, `src/scene/Board.tsx`, `src/scene/Pieces.tsx`, `src/scene/PlaceholderPiece.tsx`, `src/scene/CameraRig.tsx`, `src/scene/animationBridge.ts`, `src/scene/animationBridge.test.ts`, `src/scene/colors.ts`

**Interfaces:**
- Consumes: `ControllerStore`, `ControllerState`, `ControllerActions` (Task 7); `squareToWorld`, `isDarkSquare`, `ALL_SQUARES` (Task 2); `PIECE_HEIGHT` (Task 2); `PlacedPiece` (Task 5).
- Produces:

```ts
// context.tsx
export const ControllerProvider: React.FC<{ store: ControllerStore; children: React.ReactNode }>;
export function useController<T>(selector: (s: ControllerState & { actions: ControllerActions }) => T): T;
export function useActions(): ControllerActions;
// CameraRig.tsx
export interface CameraRigHandle { reset(): void; }
// Scene.tsx
export const Scene: React.FC<{ cameraRef: React.RefObject<CameraRigHandle | null> }>;
// animationBridge.ts
export function startAnimationBridge(store: ControllerStore, delays?: { moveMs: number; cinematicMs: number }): () => void;
```

The animation bridge is Plan 1's stand-in for the sequencer: whenever the phase becomes `animatingMove` or `cinematic`, it waits a fixed delay then calls `animationDone()`. Plan 2 replaces it with the real sequencer without touching the store.

Scene rendering in this plan is verified by eye and by the Playwright smoke test in Task 10; only the bridge has a unit test.

- [ ] **Step 1: Write the failing bridge test**

`src/scene/animationBridge.test.ts`:

```ts
import { createGameCore } from '../core/gameCore';
import { createController } from '../controller/store';
import { startAnimationBridge } from './animationBridge';

test('bridge calls animationDone after the move delay', () => {
  vi.useFakeTimers();
  const store = createController({ core: createGameCore(), engine: null, saveSettings: () => {} });
  const stop = startAnimationBridge(store, { moveMs: 350, cinematicMs: 4000 });
  const a = store.getState().actions;
  a.clickSquare('e2'); a.clickSquare('e4');
  expect(store.getState().phase).toBe('animatingMove');
  vi.advanceTimersByTime(349);
  expect(store.getState().phase).toBe('animatingMove');
  vi.advanceTimersByTime(1);
  expect(store.getState().phase).toBe('idle');   // no engine -> idle
  stop();
  vi.useRealTimers();
});

test('bridge uses the cinematic delay for captures and is cancelled by stop()', () => {
  vi.useFakeTimers();
  const core = createGameCore('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const store = createController({ core, engine: null, saveSettings: () => {} });
  const stop = startAnimationBridge(store, { moveMs: 350, cinematicMs: 4000 });
  const a = store.getState().actions;
  a.clickSquare('e4'); a.clickSquare('d5');
  expect(store.getState().phase).toBe('cinematic');
  vi.advanceTimersByTime(3999);
  expect(store.getState().phase).toBe('cinematic');
  stop();
  vi.advanceTimersByTime(10);
  expect(store.getState().phase).toBe('cinematic');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/scene`
Expected: FAIL, `Cannot find module './animationBridge'`

- [ ] **Step 3: Implement the bridge**

`src/scene/animationBridge.ts`:

```ts
import type { ControllerStore } from '../controller/store';

const DEFAULT_DELAYS = { moveMs: 350, cinematicMs: 4000 };

/** Plan 1 stand-in for the sequencer: completes moves after a fixed delay. */
export function startAnimationBridge(store: ControllerStore, delays = DEFAULT_DELAYS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.phase === prev.phase) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (s.phase === 'animatingMove' || s.phase === 'cinematic') {
      const ms = s.phase === 'cinematic' ? delays.cinematicMs : delays.moveMs;
      timer = setTimeout(() => {
        timer = null;
        store.getState().actions.animationDone();
      }, ms);
    }
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
```

- [ ] **Step 4: Run the bridge test**

Run: `pnpm test src/scene`
Expected: 2 tests pass.

- [ ] **Step 5: Write the context**

`src/controller/context.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ControllerActions, ControllerState, ControllerStore } from './store';

const Ctx = createContext<ControllerStore | null>(null);

export function ControllerProvider({ store, children }: { store: ControllerStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useControllerStore(): ControllerStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useController must be used inside <ControllerProvider>');
  return store;
}

export function useController<T>(selector: (s: ControllerState & { actions: ControllerActions }) => T): T {
  return useStore(useControllerStore(), selector);
}

export function useActions(): ControllerActions {
  return useController((s) => s.actions);
}
```

- [ ] **Step 6: Write the scene components**

`src/scene/colors.ts`:

```ts
export const SQUARE_COLORS = {
  light: '#8c8378',
  dark: '#3b3733',
  highlight: '#ffd66b',
  capture: '#ff5a3c',
  selected: '#ffffff',
} as const;

export const SIDE_COLORS = { w: '#f4e9c8', b: '#5a0d0d' } as const;
```

`src/scene/Board.tsx`:

```tsx
import { useMemo } from 'react';
import { ALL_SQUARES, isDarkSquare, squareToWorld } from '../core/squares';
import type { Square } from '../core/types';
import { useActions, useController } from '../controller/context';
import { SQUARE_COLORS } from './colors';

function squareColor(sq: Square, selected: Square | null, targets: Square[], occupied: Set<Square>): string {
  if (sq === selected) return SQUARE_COLORS.selected;
  if (targets.includes(sq)) return occupied.has(sq) ? SQUARE_COLORS.capture : SQUARE_COLORS.highlight;
  return isDarkSquare(sq) ? SQUARE_COLORS.dark : SQUARE_COLORS.light;
}

export function Board() {
  const { clickSquare } = useActions();
  const selected = useController((s) => s.selected);
  const targets = useController((s) => s.legalTargets);
  const pieces = useController((s) => s.pieces);
  const occupied = useMemo(
    () => new Set(Object.values(pieces).filter((p) => !p.captured).map((p) => p.square)),
    [pieces],
  );

  return (
    <group>
      {/* Slab under the squares */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[9, 0.3, 9]} />
        <meshStandardMaterial color="#1b1a1f" roughness={0.9} />
      </mesh>
      {ALL_SQUARES.map((sq) => {
        const { x, z } = squareToWorld(sq);
        return (
          <mesh
            key={sq}
            name={`square-${sq}`}
            position={[x, 0.005, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              clickSquare(sq);
            }}
          >
            <planeGeometry args={[1, 1]} />
            <meshStandardMaterial color={squareColor(sq, selected, targets, occupied)} roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}
```

`src/scene/PlaceholderPiece.tsx`:

```tsx
import { squareToWorld } from '../core/squares';
import { PIECE_HEIGHT, type Piece, type Square } from '../core/types';
import { SIDE_COLORS } from './colors';

interface Props {
  piece: Piece;
  square: Square;
  onClick: () => void;
}

/** Primitive stand-ins until Plan 2 loads real models: capsule for pawns, box for rooks, cone otherwise. */
export function PlaceholderPiece({ piece, square, onClick }: Props) {
  const { x, z } = squareToWorld(square);
  const h = PIECE_HEIGHT[piece.type];
  const color = SIDE_COLORS[piece.color];
  const rotationY = piece.color === 'b' ? Math.PI : 0;
  return (
    <group position={[x, 0, z]} rotation={[0, rotationY, 0]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {piece.type === 'p' && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <capsuleGeometry args={[0.18, h - 0.36, 4, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {piece.type === 'r' && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[0.45, h, 0.45]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {piece.type !== 'p' && piece.type !== 'r' && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <coneGeometry args={[0.3, h, piece.type === 'k' ? 4 : piece.type === 'q' ? 8 : 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}
```

`src/scene/Pieces.tsx`:

```tsx
import { useActions, useController } from '../controller/context';
import { PlaceholderPiece } from './PlaceholderPiece';

export function Pieces() {
  const pieces = useController((s) => s.pieces);
  const { clickSquare } = useActions();
  return (
    <group>
      {Object.entries(pieces)
        .filter(([, p]) => !p.captured)
        .map(([id, p]) => (
          <PlaceholderPiece key={id} piece={p.piece} square={p.square} onClick={() => clickSquare(p.square)} />
        ))}
    </group>
  );
}
```

`src/scene/CameraRig.tsx`:

```tsx
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useThree } from '@react-three/fiber';

export interface CameraRigHandle {
  reset(): void;
}

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 7, 7.5];

export const CameraRig = forwardRef<CameraRigHandle>(function CameraRig(_, ref) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);

  useImperativeHandle(ref, () => ({
    reset() {
      camera.position.set(...DEFAULT_CAMERA_POSITION);
      controls.current?.target.set(0, 0, 0);
      controls.current?.update();
    },
  }));

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minDistance={5}
      maxDistance={16}
      maxPolarAngle={Math.PI / 2.3}
      target={[0, 0, 0]}
    />
  );
});
```

`src/scene/Scene.tsx`:

```tsx
import type { RefObject } from 'react';
import { Board } from './Board';
import { Pieces } from './Pieces';
import { CameraRig, type CameraRigHandle } from './CameraRig';

export function Scene({ cameraRef }: { cameraRef: RefObject<CameraRigHandle | null> }) {
  return (
    <>
      <color attach="background" args={['#0b0b0e']} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[4, 10, 6]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight position={[0, 12, 0]} angle={0.5} penumbra={0.6} intensity={30} castShadow />
      <Board />
      <Pieces />
      <CameraRig ref={cameraRef} />
    </>
  );
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors. If `three-stdlib` types are missing, run `pnpm add -D three-stdlib` (drei depends on it, this only exposes the type).

```bash
git add src/controller/context.tsx src/scene
git commit -m "feat(scene): add R3F board, placeholder pieces, camera rig and animation bridge"
```

---

### Task 9: UI overlay

**Files:**
- Create: `src/ui/Overlay.tsx`, `src/ui/TopBar.tsx`, `src/ui/MoveList.tsx`, `src/ui/SettingsDrawer.tsx`, `src/ui/GameOverBanner.tsx`, `src/ui/PromotionDialog.tsx`, `src/ui/overlay.css`, `src/ui/Overlay.test.tsx`

**Interfaces:**
- Consumes: `useController`, `useActions` (Task 8); `ControllerStore`, `createController` (Task 7); `Phase`, `GameOverReason`, `PromotionPiece`.
- Produces: `export const Overlay: React.FC<{ onResetView: () => void }>`.

- [ ] **Step 1: Write the failing overlay tests**

`src/ui/Overlay.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { createGameCore } from '../core/gameCore';
import { createController } from '../controller/store';
import { ControllerProvider } from '../controller/context';
import { Overlay } from './Overlay';

function mount(fen?: string) {
  const store = createController({ core: createGameCore(fen), engine: null, saveSettings: () => {} });
  const onResetView = vi.fn();
  render(
    <ControllerProvider store={store}>
      <Overlay onResetView={onResetView} />
    </ControllerProvider>,
  );
  return { store, onResetView, a: store.getState().actions };
}

test('top bar buttons call the actions', () => {
  const { store, onResetView, a } = mount();
  a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
  fireEvent.click(screen.getByRole('button', { name: /undo/i }));
  expect(store.getState().history).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /reset view/i }));
  expect(onResetView).toHaveBeenCalled();
  a.clickSquare('e2'); a.clickSquare('e4');
  fireEvent.click(screen.getByRole('button', { name: /new game/i }));
  expect(store.getState().history).toHaveLength(0);
});

test('move list shows SAN in numbered pairs', () => {
  const { a } = mount();
  a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone();
  a.clickSquare('e7'); a.clickSquare('e5'); a.animationDone();
  a.clickSquare('g1'); a.clickSquare('f3'); a.animationDone();
  expect(screen.getByText('1.')).toBeInTheDocument();
  expect(screen.getByText('e4')).toBeInTheDocument();
  expect(screen.getByText('e5')).toBeInTheDocument();
  expect(screen.getByText('2.')).toBeInTheDocument();
  expect(screen.getByText('Nf3')).toBeInTheDocument();
});

test('promotion dialog appears in promoting phase and chooses a piece', () => {
  const { store, a } = mount('8/P7/8/8/8/8/8/k6K w - - 0 1');
  a.clickSquare('a7'); a.clickSquare('a8');
  fireEvent.click(screen.getByRole('button', { name: /knight/i }));
  expect(store.getState().lastMove?.promotion).toBe('n');
});

test('promotion dialog cancels on Escape', () => {
  const { store, a } = mount('8/P7/8/8/8/8/8/k6K w - - 0 1');
  a.clickSquare('a7'); a.clickSquare('a8');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(store.getState().phase).toBe('selected');
});

test('skip button shows only during a cinematic', () => {
  const { store, a } = mount('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  a.clickSquare('e4'); a.clickSquare('d5');
  fireEvent.click(screen.getByRole('button', { name: /skip/i }));
  expect(store.getState().phase).toBe('idle');
});

test('game over banner shows the result', () => {
  const { a } = mount('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
  a.clickSquare('h5'); a.clickSquare('f7'); a.skipCinematic();
  expect(screen.getByText(/checkmate/i)).toBeInTheDocument();
  expect(screen.getByText(/white wins/i)).toBeInTheDocument();
});

test('settings drawer updates settings', () => {
  const { store } = mount();
  fireEvent.click(screen.getByRole('button', { name: /settings/i }));
  fireEvent.click(screen.getByLabelText(/cinematics/i));
  expect(store.getState().settings.cinematics).toBe(false);
  fireEvent.change(screen.getByLabelText(/difficulty/i), { target: { value: '15' } });
  expect(store.getState().settings.skill).toBe(15);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/ui`
Expected: FAIL, `Cannot find module './Overlay'`

- [ ] **Step 3: Implement the overlay components**

`src/ui/overlay.css`:

```css
.overlay { position: absolute; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; color: #eae6df; }
.overlay > * { pointer-events: auto; }
.topbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; }
.btn { background: #23222a; color: #eae6df; border: 1px solid #3b3a44; border-radius: 6px; padding: 8px 12px; cursor: pointer; font-size: 14px; }
.btn:hover { background: #2e2d36; }
.btn:disabled { opacity: 0.4; cursor: default; }
.movelist { position: absolute; top: 12px; right: 12px; width: 180px; max-height: 60vh; overflow-y: auto; background: rgba(20,20,26,0.85); border-radius: 8px; padding: 8px 12px; font-size: 14px; }
.movelist-row { display: grid; grid-template-columns: 28px 1fr 1fr; gap: 6px; padding: 2px 0; }
.movelist-num { opacity: 0.5; }
.drawer { position: absolute; bottom: 12px; left: 12px; background: rgba(20,20,26,0.92); border-radius: 8px; padding: 12px 16px; display: grid; gap: 10px; min-width: 220px; }
.drawer label { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; }
.skip { position: absolute; bottom: 24px; right: 24px; }
.banner { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); background: rgba(20,20,26,0.95); border-radius: 12px; padding: 24px 32px; text-align: center; display: grid; gap: 12px; }
.banner h2 { margin: 0; font-size: 28px; }
.promo { position: absolute; top: 30%; left: 50%; transform: translateX(-50%); background: rgba(20,20,26,0.95); border-radius: 12px; padding: 16px; display: flex; gap: 8px; }
.status { position: absolute; bottom: 12px; right: 12px; font-size: 13px; opacity: 0.7; }
.error { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); background: #5a1a1a; padding: 8px 14px; border-radius: 6px; font-size: 13px; }
```

`src/ui/TopBar.tsx`:

```tsx
import { useActions, useController } from '../controller/context';

export function TopBar({ onResetView, onToggleSettings }: { onResetView: () => void; onToggleSettings: () => void }) {
  const { newGame, undo } = useActions();
  const phase = useController((s) => s.phase);
  const canUndo = useController((s) => s.history.length > 0 && !['promoting', 'animatingMove', 'cinematic'].includes(s.phase));
  return (
    <div className="topbar">
      <button className="btn" onClick={newGame}>New Game</button>
      <button className="btn" onClick={undo} disabled={!canUndo}>Undo</button>
      <button className="btn" onClick={onResetView}>Reset View</button>
      <button className="btn" onClick={onToggleSettings}>Settings</button>
      <span className="btn" style={{ cursor: 'default' }} aria-live="polite">
        {phase === 'engineThinking' ? 'Thinking…' : phase === 'gameOver' ? 'Game over' : ''}
      </span>
    </div>
  );
}
```

`src/ui/MoveList.tsx`:

```tsx
import { useController } from '../controller/context';

export function MoveList() {
  const history = useController((s) => s.history);
  const rows: { n: number; w: string; b?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: history[i]!.san, b: history[i + 1]?.san });
  }
  return (
    <div className="movelist" aria-label="Move list">
      {rows.length === 0 && <div style={{ opacity: 0.5 }}>No moves yet</div>}
      {rows.map((r) => (
        <div className="movelist-row" key={r.n}>
          <span className="movelist-num">{r.n}.</span>
          <span>{r.w}</span>
          <span>{r.b ?? ''}</span>
        </div>
      ))}
    </div>
  );
}
```

`src/ui/SettingsDrawer.tsx`:

```tsx
import { useActions, useController } from '../controller/context';

export function SettingsDrawer() {
  const settings = useController((s) => s.settings);
  const engineStatus = useController((s) => s.engineStatus);
  const { updateSettings } = useActions();
  return (
    <div className="drawer" role="group" aria-label="Settings">
      <label>
        Difficulty ({settings.skill})
        <input
          type="range"
          min={1}
          max={20}
          value={settings.skill}
          onChange={(e) => updateSettings({ skill: Number(e.target.value) })}
          disabled={settings.twoPlayer}
        />
      </label>
      <label>
        Cinematics
        <input type="checkbox" checked={settings.cinematics} onChange={(e) => updateSettings({ cinematics: e.target.checked })} />
      </label>
      <label>
        Sound
        <input type="checkbox" checked={settings.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
      </label>
      <label>
        Two player (no engine)
        <input
          type="checkbox"
          checked={settings.twoPlayer}
          disabled={engineStatus === 'failed'}
          onChange={(e) => updateSettings({ twoPlayer: e.target.checked })}
        />
      </label>
    </div>
  );
}
```

`src/ui/GameOverBanner.tsx`:

```tsx
import { useActions, useController } from '../controller/context';
import type { Color, GameOverReason } from '../core/types';

function describe(reason: GameOverReason, sideToMove: Color): { title: string; detail: string } {
  if (reason === 'checkmate') {
    const winner = sideToMove === 'w' ? 'Black' : 'White';
    return { title: 'Checkmate', detail: `${winner} wins` };
  }
  const labels: Record<Exclude<GameOverReason, 'checkmate'>, string> = {
    stalemate: 'Stalemate',
    insufficient: 'Insufficient material',
    threefold: 'Threefold repetition',
    'fifty-move': 'Fifty-move rule',
  };
  return { title: 'Draw', detail: labels[reason] };
}

export function GameOverBanner() {
  const gameOver = useController((s) => s.gameOver);
  const turn = useController((s) => s.turn);
  const phase = useController((s) => s.phase);
  const { newGame } = useActions();
  if (phase !== 'gameOver' || !gameOver) return null;
  const { title, detail } = describe(gameOver, turn);
  return (
    <div className="banner" role="dialog" aria-label="Game over">
      <h2>{title}</h2>
      <div>{detail}</div>
      <button className="btn" onClick={newGame}>New Game</button>
    </div>
  );
}
```

`src/ui/PromotionDialog.tsx`:

```tsx
import { useEffect } from 'react';
import { useActions, useController } from '../controller/context';
import type { PromotionPiece } from '../core/types';

const CHOICES: { piece: PromotionPiece; label: string }[] = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
];

export function PromotionDialog() {
  const phase = useController((s) => s.phase);
  const { choosePromotion, cancelPromotion } = useActions();
  const open = phase === 'promoting';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelPromotion(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, cancelPromotion]);

  if (!open) return null;
  return (
    <div className="promo" role="dialog" aria-label="Choose promotion">
      {CHOICES.map((c) => (
        <button key={c.piece} className="btn" onClick={() => choosePromotion(c.piece)}>{c.label}</button>
      ))}
    </div>
  );
}
```

`src/ui/Overlay.tsx`:

```tsx
import { useState } from 'react';
import { useActions, useController } from '../controller/context';
import { TopBar } from './TopBar';
import { MoveList } from './MoveList';
import { SettingsDrawer } from './SettingsDrawer';
import { GameOverBanner } from './GameOverBanner';
import { PromotionDialog } from './PromotionDialog';
import './overlay.css';

export function Overlay({ onResetView }: { onResetView: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const phase = useController((s) => s.phase);
  const engineError = useController((s) => s.engineError);
  const { skipCinematic } = useActions();
  return (
    <div className="overlay">
      <TopBar onResetView={onResetView} onToggleSettings={() => setSettingsOpen((o) => !o)} />
      <MoveList />
      {settingsOpen && <SettingsDrawer />}
      {phase === 'cinematic' && <button className="btn skip" onClick={skipCinematic}>Skip</button>}
      {engineError && <div className="error" role="alert">Engine unavailable ({engineError}). Two-player mode enabled.</div>}
      <GameOverBanner />
      <PromotionDialog />
    </div>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test src/ui && pnpm typecheck`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat(ui): add overlay with top bar, move list, settings, promotion and game over"
```

---

### Task 10: App wiring and browser smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `src/appStore.ts`
- Modify: `src/App.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `createGameCore` (Task 3), `createEngine`, `stockfishWorkerFactory` (Task 4), `createController`, `ControllerStore` (Task 7), `loadSettings` (Task 6), `ControllerProvider` (Task 8), `Scene`, `CameraRigHandle`, `startAnimationBridge` (Task 8), `Overlay` (Task 9).
- Produces: `createAppStore(): ControllerStore` and, in dev and test builds only, `window.__chess3d` holding the store for end-to-end tests.

- [ ] **Step 1: Write the app store factory**

`src/appStore.ts`:

```ts
import { createGameCore } from './core/gameCore';
import { createEngine, type Engine } from './engine/engine';
import { stockfishWorkerFactory } from './engine/stockfishWorker';
import { createController, type ControllerStore } from './controller/store';
import { loadSettings } from './controller/settings';

declare global {
  interface Window {
    __chess3d?: ControllerStore;
  }
}

export function createAppStore(): ControllerStore {
  let engine: Engine | null = null;
  try {
    engine = createEngine(stockfishWorkerFactory);
  } catch (e) {
    console.warn('Engine could not be created', e);
  }
  const store = createController({ core: createGameCore(), engine, settings: loadSettings() });
  if (import.meta.env.DEV) window.__chess3d = store;
  return store;
}
```

- [ ] **Step 2: Update the App test to mock the canvas and engine**

Replace `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('@react-three/fiber', () => ({ Canvas: () => <div data-testid="canvas" /> }));
vi.mock('./engine/stockfishWorker', () => ({
  stockfishWorkerFactory: () => ({ postMessage() {}, onmessage: null, terminate() {} }),
}));

test('renders the canvas and the overlay controls', () => {
  render(<App />);
  expect(screen.getByTestId('canvas')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /new game/i })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/App.test.tsx`
Expected: FAIL, no canvas test id and no New Game button (App still renders an `<h1>`).

- [ ] **Step 4: Write App.tsx**

`src/App.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { createAppStore } from './appStore';
import { ControllerProvider } from './controller/context';
import { Scene } from './scene/Scene';
import { startAnimationBridge } from './scene/animationBridge';
import type { CameraRigHandle } from './scene/CameraRig';
import { Overlay } from './ui/Overlay';
import { DEFAULT_CAMERA_POSITION } from './scene/CameraRig';

export function App() {
  const store = useMemo(createAppStore, []);
  const cameraRef = useRef<CameraRigHandle>(null);

  useEffect(() => startAnimationBridge(store), [store]);

  return (
    <ControllerProvider store={store}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <Canvas shadows camera={{ position: DEFAULT_CAMERA_POSITION, fov: 45 }} dpr={[1, 2]}>
          <Scene cameraRef={cameraRef} />
        </Canvas>
        <Overlay onResetView={() => cameraRef.current?.reset()} />
      </div>
    </ControllerProvider>
  );
}
```

- [ ] **Step 5: Run unit tests, typecheck, and look at it**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass.

Run: `pnpm dev` and open the printed URL. Check by eye:
- A dark board with 32 primitive pieces, white side nearest the camera.
- Click e2: the square turns white and e3, e4 turn yellow. Click e4: the pawn moves, the top bar shows "Thinking…", then a black piece moves.
- Capture something: a 4 s pause with a Skip button, then play continues.
- Orbit with the mouse, then Reset View.
- Open Settings, toggle Two player, and confirm the engine stops replying.

- [ ] **Step 6: Write the Playwright config and smoke test**

Run once: `pnpm exec playwright install chromium`

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', headless: true },
  webServer: { command: 'pnpm dev --port 5173', url: 'http://localhost:5173', reuseExistingServer: true },
});
```

`e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('app mounts, engine loads, and a move gets a reply', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /new game/i })).toBeVisible();

  // Wait for Stockfish to finish its handshake.
  await page.waitForFunction(() => window.__chess3d?.getState().engineStatus === 'ready', null, { timeout: 15_000 });

  await page.evaluate(() => {
    const a = window.__chess3d!.getState().actions;
    a.clickSquare('e2');
    a.clickSquare('e4');
  });

  // Human move animates (350 ms), engine thinks (<= 2 s), reply animates.
  await page.waitForFunction(
    () => {
      const s = window.__chess3d!.getState();
      return s.history.length === 2 && s.phase === 'idle';
    },
    null,
    { timeout: 15_000 },
  );

  await expect(page.getByText('1.')).toBeVisible();
  expect(errors).toEqual([]);
});
```

Add to `tsconfig.json` `include` if not present: `"e2e"` (already listed in Task 1). Add a type shim so `window.__chess3d` is known to the e2e file: it is declared globally in `src/appStore.ts`, which is in the same TypeScript program.

- [ ] **Step 7: Run the smoke test**

Run: `pnpm e2e`
Expected: 1 passed. If it fails on `engineStatus === 'ready'`, open the dev URL, check the Network tab for a 404 on the Stockfish `.js` or `.wasm`, and fix `STOCKFISH_URL` in `src/engine/stockfishWorker.ts` to match the file name printed by `node scripts/copy-stockfish.mjs`.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/appStore.ts playwright.config.ts e2e
git commit -m "feat: wire app with canvas, overlay, engine and browser smoke test"
```

---

## Done Criteria for Plan 1

- `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm e2e` all pass.
- In the browser: a full game against Stockfish can be played to checkmate, including a promotion and a castle, with undo working in both idle and thinking states.
- With `public/stockfish/` deleted, the app shows the engine error and two-player mode works.

## Hand-off to Plan 2 (packs and cinematics)

Plan 2 replaces exactly these pieces and nothing else:

- `src/scene/PlaceholderPiece.tsx` is replaced by a `PieceModel` that loads a glb from the active set pack and falls back to the placeholder on load failure.
- `src/scene/animationBridge.ts` is replaced by the sequencer, which subscribes to the same `phase` transitions and calls the same `actions.animationDone()`.
- `src/scene/Board.tsx` gets its slab and colors from the board pack manifest instead of `src/scene/colors.ts`.
- `src/ui/PromotionDialog.tsx` gains an in-scene 3D variant; the HTML version stays as the fallback.

Spec items deliberately left to Plan 2: the WebGL context-lost overlay, the audio autoplay handling, and the in-scene 3D promotion picker.

The store, core, engine, and tracker interfaces are frozen at the signatures listed in Tasks 3 to 7.
