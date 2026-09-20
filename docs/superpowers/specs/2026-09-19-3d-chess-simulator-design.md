# 3D Chess Simulator: Version A Design

**Date:** 2026-09-19
**Status:** Approved in brainstorming, pending spec review

## 1. Summary

A browser-based 3D chess simulator with full chess rules, a Stockfish opponent, an
AI-generated Angels vs Demons piece set, a living stone board, and cinematic capture
sequences. Version A is single-player against the computer with no accounts. The
architecture is built so that later versions add themed content packs (Version B) and
user-uploaded pieces generated from 2D images (Version C) without restructuring.

## 2. Goals and Non-Goals

### Goals (Version A)

- Play a full, legal game of chess against Stockfish in a browser, from opening to
  checkmate, stalemate, or draw.
- One polished set (Angels vs Demons) and one board (carved stone with an animated
  lava-crack shader).
- Every capture plays a skippable cinematic fight sequence.
- Sets and boards are data packs loaded from a manifest, not hard-coded.
- The art pipeline that produces the first set is a script that later becomes the
  Version C upload service.
- Runs well on a mid-range laptop in Chrome, Safari, and Firefox.

### Non-Goals (Version A)

- Accounts, saved games across devices, purchases, online multiplayer.
- Combat that changes the outcome of a capture. The attacker always wins.
- Unique fight choreography per piece pairing.
- Drag-to-move input.
- In-app piece upload or generation.
- Mobile touch layout. It should not be broken on mobile, but it is not designed for it.

## 3. Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, strict mode |
| Build | Vite |
| UI | React 19 |
| 3D | Three.js via React Three Fiber, with `@react-three/drei` and `@react-three/postprocessing` |
| Chess rules | `chess.js` |
| Opponent | Stockfish compiled to WebAssembly, run in a Web Worker |
| Animation sequencing | Custom sequencer (plain TypeScript) plus Three.js `AnimationMixer` |
| Model format | glTF binary (`.glb`) |
| Testing | Vitest for unit tests, one Playwright smoke test for scene mount |
| Art generation | Image model for concepts, Meshy image-to-3D and auto-rigging APIs, Node normalizer script |

Node 20 or newer. Package manager is pnpm.

## 4. Architecture

Three layers, communicating only through defined interfaces, coordinated by one
controller.

```
+-----------------+       +------------------------+       +------------------+
|   React UI      |<----->|    Game Controller     |<----->|  R3F Scene       |
| menus, move     |       |  state machine, owns   |       |  board, pieces,  |
| list, settings  |       |  all state transitions |       |  camera, effects |
+-----------------+       +-----------+------------+       +--------+---------+
                                      |                             |
                          +-----------+-----------+       +---------+---------+
                          |                       |       |                   |
                   +------+------+       +--------+---+   |   Content Packs   |
                   |  Game Core  |       |  Engine    |   |  set + board      |
                   |  chess.js   |       |  Stockfish |   |  manifests, glb,  |
                   |  wrapper    |       |  worker    |   |  audio, effects   |
                   +-------------+       +------------+   +-------------------+
```

### 4.1 Game Core (`src/core/`)

A pure TypeScript wrapper around chess.js. No React, no Three.js, no DOM.

Responsibilities:

- Hold the current position and move history.
- Answer: legal moves for a square, whose turn, in check, game over and why.
- Apply a move and report what happened: the moving piece, captured piece if any,
  castling rook movement, en passant capture square, promotion piece.
- Undo the last move (or last two, when undoing against the engine).
- Export FEN for the engine.

Interface:

```ts
type Square = 'a1' | 'a2' | /* ... */ 'h8';
type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Color = 'w' | 'b';

interface Piece { type: PieceType; color: Color; }

interface MoveRequest { from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n'; }

interface MoveResult {
  from: Square;
  to: Square;
  piece: Piece;
  captured?: { piece: Piece; square: Square };   // square differs from `to` on en passant
  castle?: { rookFrom: Square; rookTo: Square };
  promotion?: PieceType;
  san: string;
  check: boolean;
  gameOver?: GameOverReason;
}

type GameOverReason = 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty-move';

interface GameCore {
  fen(): string;
  turn(): Color;
  pieceAt(square: Square): Piece | null;
  legalMoves(from: Square): Square[];
  needsPromotion(from: Square, to: Square): boolean;
  move(req: MoveRequest): MoveResult;        // throws on illegal move
  undo(): MoveResult | null;
  history(): MoveResult[];
  inCheck(): boolean;
  gameOver(): GameOverReason | null;
  reset(): void;
}
```

### 4.2 Engine (`src/engine/`)

Stockfish WebAssembly in a Web Worker, speaking UCI.

```ts
interface Engine {
  ready(): Promise<void>;
  setSkill(level: number): void;               // 0..20, maps to UCI Skill Level
  bestMove(fen: string, moveTimeMs: number): Promise<MoveRequest>;
  stop(): void;
  dispose(): void;
}
```

If the worker fails to initialize within 10 seconds, `ready()` rejects. The
controller then offers local two-player mode.

### 4.3 Game Controller (`src/controller/`)

A state machine. It is the only code that calls `GameCore.move`. UI and scene subscribe
to it through a small store (Zustand).

States:

```
idle              waiting for the human to select a piece
selected          a piece is selected, legal targets highlighted
promoting         waiting for the human to choose a promotion piece
engineThinking    waiting on Stockfish
animatingMove     a non-capture move is sliding a piece (short)
cinematic         a capture fight is playing
gameOver          terminal, with reason
```

Transitions. All click events arrive through `clickSquare`; the event names below
describe what was on the clicked square.

| From | Event | To |
|---|---|---|
| idle | clickPiece(own) | selected |
| selected | clickPiece(own, different) | selected |
| selected | clickSquare(legal, no promotion) | animatingMove or cinematic |
| selected | clickSquare(legal, promotion) | promoting |
| selected | clickSquare(illegal) or clickSameSquare | idle |
| promoting | choose(piece) | animatingMove or cinematic |
| promoting | cancel | selected |
| animatingMove | done | engineThinking, idle, or gameOver |
| cinematic | done or skip | engineThinking, idle, or gameOver |
| engineThinking | bestMove | animatingMove or cinematic |
| any non-terminal | newGame | idle |
| idle, selected, gameOver | undo | idle |

Rules the tests must enforce:

- Clicks are ignored in `promoting` (except the overlay), `engineThinking`,
  `animatingMove`, and `cinematic`.
- `undo` while the engine is thinking calls `Engine.stop()` first, then undoes one
  move (the human's).
- `undo` in `idle` after an engine reply undoes two moves.
- Skipping a cinematic finishes it instantly: the board ends in the same state as if it
  had played out.
- If cinematics are disabled in settings, captures go through `animatingMove` instead.

The controller exposes:

```ts
type PieceId = string;   // assigned at game start, stable for the piece's lifetime

interface ControllerState {
  phase: Phase;
  pieces: Record<PieceId, { square: Square; piece: Piece }>;   // what the scene renders
  selected: Square | null;
  legalTargets: Square[];
  lastMove: MoveResult | null;
  pendingPromotion: { from: Square; to: Square } | null;
  gameOver: GameOverReason | null;
  settings: { skill: number; cinematics: boolean; sound: boolean; twoPlayer: boolean };
}

interface ControllerActions {
  clickSquare(sq: Square): void;
  choosePromotion(p: 'q' | 'r' | 'b' | 'n'): void;
  cancelPromotion(): void;
  skipCinematic(): void;
  undo(): void;
  newGame(): void;
  updateSettings(patch: Partial<ControllerState['settings']>): void;
  // called by the scene
  animationDone(): void;
}
```

### 4.4 Presentation (`src/scene/`)

The React Three Fiber scene. It reads `ControllerState` and renders. It never mutates
game state; it calls `clickSquare` and `animationDone`.

Components:

- `Board`: loads the active board pack, renders the slab, square materials, highlight
  overlays for selected and legal squares, and the lava-crack shader.
- `Pieces`: one `PieceModel` per piece on the board, keyed by a stable piece id so a
  piece keeps its model instance when it moves. Ids are assigned at game start and
  tracked through `MoveResult`s by the controller.
- `PieceModel`: loads a glb from the set pack, plays `idle`, and exposes an imperative
  handle the sequencer uses: `play(clip, opts)`, `moveTo(square, durationMs)`,
  `fadeOut(durationMs)`.
- `CameraRig`: orbit controls with limits (no going under the board, min and max
  distance), a "reset view" action, and an imperative handle the sequencer uses to
  fly to a target and back.
- `Effects`: post-processing (bloom, subtle vignette) and a particle emitter the
  sequencer triggers at an impact point with a set-defined style.
- `PromotionOverlay`: four clickable models from the active set floating above the
  board.

Fallbacks:

- A model that fails to load (404, parse error) renders as a placeholder: a capsule
  for pawns, a box for rooks, a cone for everything else, in the side's color from
  the manifest. A warning is logged once per model. Play continues.
- A model with no animation clips uses the rigid fallback set (section 5.3).

### 4.5 Sequencer (`src/sequencer/`)

Plain TypeScript, no React. Runs a list of timed steps against imperative handles and
a clock. Tested with a fake clock.

```ts
interface SequencerHandles {
  piece(id: PieceId): PieceHandle;
  camera: CameraHandle;
  effects: EffectsHandle;
  audio: AudioHandle;
}

interface Sequencer {
  run(sequence: Sequence, handles: SequencerHandles): { done: Promise<void>; skip(): void };
}
```

A `Sequence` is data: an ordered list of steps, each with a start time (ms), a target,
an action, and a duration. `skip()` jumps every step to its end state and resolves
`done`. The default capture sequence is in section 6. Set packs may override it later.

### 4.6 Content Packs (`public/packs/`)

Loaded by URL. The active set and board are selected in a config constant for
Version A and become user-selectable in Version B.

## 5. Set Pack Format

```
public/packs/sets/angels-vs-demons/
  manifest.json
  models/
    w-king.glb  w-queen.glb  w-rook.glb  w-bishop.glb  w-knight.glb  w-pawn.glb
    b-king.glb  b-queen.glb  b-rook.glb  b-bishop.glb  b-knight.glb  b-pawn.glb
  audio/
    attack.ogg  hit.ogg  die.ogg  (optionally per piece type: attack-king.ogg ...)
  preview.png
```

### 5.1 Manifest

```json
{
  "id": "angels-vs-demons",
  "name": "Angels vs Demons",
  "version": 1,
  "sides": {
    "w": { "name": "Angels", "color": "#f4e9c8", "impactEffect": "light" },
    "b": { "name": "Demons", "color": "#5a0d0d", "impactEffect": "fire" }
  },
  "pieces": {
    "w-king":   { "model": "models/w-king.glb",   "clips": ["idle", "attack", "hit", "die", "victory"] },
    "w-pawn":   { "model": "models/w-pawn.glb",   "clips": [] },
    "b-rook":   { "model": "models/b-rook.glb",   "clips": [] }
  },
  "audio": { "attack": "audio/attack.ogg", "hit": "audio/hit.ogg", "die": "audio/die.ogg" },
  "sequenceOverride": null
}
```

`impactEffect` is one of a fixed enum the engine knows how to render: `light`, `fire`,
`ice`, `shadow`, `sparks`. New effects are engine work, not pack work.

### 5.2 Model Conventions

Every glb must satisfy these or the normalizer rejects it:

- Y-up, feet (or base) at y = 0, centered on x and z.
- Faces +Z ("forward" means toward the opponent when placed on white's side; black
  pieces are rotated 180 degrees by the engine, not baked into the model).
- Height: king 1.0 units, queen 0.9, bishop and knight 0.75, rook 0.7, pawn 0.55.
  One square is 1.0 units wide.
- Under 2 MB per file with textures embedded, 2048 px maximum texture size.
- Animation clips, if present, named exactly `idle`, `attack`, `hit`, `die`,
  `victory`. `idle` must loop cleanly.

### 5.3 Rigid Fallback Animations

Applied by the engine to any model missing a clip. They transform the whole mesh, so
they work on anything:

| Clip | Fallback |
|---|---|
| idle | slow vertical bob, 2 mm amplitude, 3 s period |
| attack | lunge forward 0.4 units and back over 600 ms with ease-out |
| hit | 80 ms recoil backward plus a red flash on the material |
| die | scale to zero with a shatter particle burst over 500 ms |
| victory | one quick hop |

## 6. Capture Cinematic

Default sequence, total about 4 s. Times are offsets from the start.

| t (ms) | Target | Action |
|---|---|---|
| 0 | camera | fly to a low three-quarter angle framing both squares, 900 ms |
| 700 | attacker | play `attack`; moveTo the defender's square minus 0.5 units, 600 ms |
| 700 | audio | play `attack` |
| 1200 | defender | play `hit` |
| 1200 | effects | burst at the defender's position using the attacker side's `impactEffect` |
| 1200 | camera | shake, 250 ms |
| 1200 | audio | play `hit` |
| 1500 | defender | play `die`; fadeOut 700 ms |
| 1500 | audio | play `die` |
| 2300 | attacker | play `victory` if available |
| 2900 | attacker | moveTo the captured square, 400 ms |
| 3000 | camera | return to the previous orbit position, 900 ms |
| 3900 | | done |

Skip jumps to the end: defender removed, attacker on the captured square, camera at
its previous position.

Non-capture moves: a 350 ms slide. Castling slides both pieces at once. Check pulses
the king's material for one second. Checkmate plays the capture-free variant: a slow
6 s orbit of the board while the losing king plays `die`.

## 7. Board Pack Format

```
public/packs/boards/stone-lava/
  manifest.json
  board.glb           slab and frame
  env.hdr             environment lighting
  preview.png
```

```json
{
  "id": "stone-lava",
  "name": "Stone and Lava",
  "version": 1,
  "model": "board.glb",
  "environment": "env.hdr",
  "squares": { "light": "#8c8378", "dark": "#3b3733", "highlight": "#ffd66b", "capture": "#ff5a3c" },
  "ambient": { "type": "lava-cracks", "intensity": 0.6 }
}
```

`ambient.type` is a fixed enum the engine renders: `none`, `lava-cracks`. Version B
adds more.

The lava-crack effect is a custom shader material applied to a crack mesh baked into
the board glb: emissive orange-red flowing along a noise field, feeding bloom.

## 8. User Interface

Minimal React overlay:

- Top bar: New Game, Undo, Reset View.
- Side panel: move list in SAN, collapsible.
- Settings drawer: difficulty slider (1 to 20, mapped to Stockfish Skill Level),
  cinematics on or off, sound on or off, two-player mode toggle (hides the engine).
- During a cinematic: a Skip button, bottom right.
- Game over: a banner with the result and a New Game button.
- Promotion: `PromotionOverlay` in the scene, with an Escape key to cancel.

No routing. No accounts. Settings persist to localStorage.

## 9. Art Pipeline (`tools/`)

A set of Node scripts, not part of the shipped app. This pipeline is the seed of the
Version C upload service.

```
tools/
  generate-concepts.ts    prompt template per piece type, calls an image model
  generate-models.ts      calls Meshy image-to-3D per concept, polls, downloads glb
  rig-models.ts           calls Meshy auto-rigging for humanoid pieces, downloads rigged glb
  normalize.ts            scale, center, rename clips, validate, write manifest entry
  build-manifest.ts       assembles manifest.json from normalized models
```

Version A plan: rig king, queen, bishop, and knight on both sides (8 models). Pawns
and rooks ship with no clips and use the rigid fallback (4 models). Generation
results are curated by hand; expect two or three attempts per piece.

`normalize.ts` is the only script with unit tests, run against a fixture glb. It must:

- Reject non-Y-up or off-center models with a clear message.
- Scale to the height table in section 5.2.
- Rename clips from a mapping (for example `Armature|Attack` to `attack`).
- Fail if a clip name outside the standard five remains.
- Strip clips the manifest doesn't list.

API keys live in `.env` and are never committed.

## 10. Error Handling

| Failure | Behavior |
|---|---|
| Model 404 or parse error | Placeholder geometry, one console warning, play continues |
| Missing clip | Rigid fallback |
| Stockfish fails to start | Toast with the error, two-player mode enabled automatically |
| Stockfish returns no move (should not happen) | Retry once, then surface an error and enable two-player |
| Illegal move requested (bug) | Controller catches, logs, returns to `idle` |
| WebGL context lost | Overlay asking to reload |
| Audio blocked by autoplay policy | Sound stays muted until first click, no error |

## 11. Testing

| Layer | Tool | What |
|---|---|---|
| Game core | Vitest | Legal moves, captures, castling both sides, en passant, promotion, check, checkmate, stalemate, undo, FEN export. Fixture positions in a table. |
| Engine wrapper | Vitest with a fake worker | UCI parsing, timeout, stop, skill setting |
| Controller | Vitest | Every transition in the table in 4.3, input ignored in busy states, undo semantics, skip semantics, cinematics-off routing |
| Sequencer | Vitest with fake clock and recording handles | Step ordering and timing for the default sequence, skip ends in the terminal state |
| Normalizer | Vitest | Fixture glb: scale, pivot, clip renaming, rejections |
| Scene | Playwright | Scene mounts with the real packs, no console errors, one move can be made |

Visual quality is reviewed by eye. No screenshot diffing in Version A.

## 12. Performance Budget

- First load under 15 MB total, packs streamed after the board is visible.
- 60 fps on an Apple M1 MacBook Air in Chrome at 1440 by 900 with bloom on.
- Cinematics never drop below 30 fps on the same machine.
- Stockfish move time capped at 2 s at max skill.

## 13. Repository Layout

```
src/
  core/         game core (chess.js wrapper) + tests
  engine/       Stockfish worker wrapper + tests
  controller/   state machine, store + tests
  sequencer/    sequencer, default sequences + tests
  scene/        R3F components, shaders, fallbacks
  ui/           React overlay components
  packs/        manifest types, loader, validation
  main.tsx
public/packs/   set and board packs
tools/          art pipeline scripts + tests
docs/superpowers/specs, docs/superpowers/plans
```

## 14. Road Map

### Version B: Content Range

- Set selector and board selector in the settings drawer, reading pack manifests
  from a registry file.
- Two more sets: Vampires vs Hunters, Classic Staunton (animated with rigid fallbacks
  plus a few custom clips).
- Two more boards: Flowing Lava (animated lava rivers, scenery on the edges), Cathedral
  (stained-glass light, dust motes).
- Per-piece-type cinematic variants via `sequenceOverride` in the manifest, starting
  with a distinct king-vs-king sequence.
- Drag-to-move.
- Mobile touch layout.
- Full rigs for pawns and rooks in the flagship set.

### Version C: Custom Pieces

- A server (Node, one small service) that runs the `tools/` pipeline on demand:
  upload an image per piece type, or one image and a style prompt to generate all
  six, then image-to-3D, auto-rig where possible, normalize, and produce a pack.
- Accounts (needed to own uploaded packs), storage for user packs, a job queue with
  progress reporting in the UI.
- A "my sets" gallery, with a regenerate button per piece.
- Moderation: uploaded images and generated models are reviewed by an automated
  classifier before they become visible to anyone but the uploader.
- Rigid fallback is the guaranteed path; auto-rigging is a bonus when it succeeds.

### Beyond C

- Online play against friends and matchmaking.
- Purchases: premium sets, board themes, generation credits.
- Arena variant: a separate mode where combat has stats and dice, clearly labeled
  as not chess.
- Replay and share a game as a video clip.

## 15. Open Risks

- **Generated model quality.** Meshy output varies. Mitigation: curation, retries,
  and the rigid fallback so nothing blocks on rigging.
- **Auto-rigging failures on non-humanoid designs.** Mitigation: design concepts as
  bipeds where rigging matters (king, queen, bishop, knight), keep rooks and pawns
  rigid.
- **Bundle and pack size on slow connections.** Mitigation: the 2 MB per model cap,
  Draco or meshopt compression in the normalizer, streaming after first paint.
- **Safari WebGL performance with post-processing.** Mitigation: a quality setting
  that disables bloom, auto-selected when the first second of frames is slow.
