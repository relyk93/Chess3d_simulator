# Meshy Generation Tooling Implementation Plan (Plan 3b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Style note:** like Plan 2, this plan records interfaces, behavior, and the assertions each task's tests make, and leaves the code to the commits. Every task is test-first: write the tests, watch them fail for the stated reason, implement, watch them pass, commit.

**Goal:** Drive Meshy from the command line to produce the Angels vs Demons set: concept image, 3D model, rig, and five animation clips per rigged piece, then assemble everything into the `set.json` that Plan 3's `build-set` consumes. Every run is resumable, budget-capped, and previewable, and nothing spends credits without an explicit flag.

**Architecture:** A small Meshy client (auth, retry, polling, download) behind a `MeshyApi` interface, so the pipeline is tested against an in-memory fake and never the network. A `design.json` describes the set (style, prompts, which pieces are rigged, animation action ids). A `jobs.json` records every task id, status, downloaded file, and credit cost the moment they exist, so an interrupted run resumes instead of paying twice. Four stages (`concept`, `model`, `rig`, `animate`) each skip finished work, respect a budget cap, and can be planned with `--dry-run`. `assemble` turns the results into `set.json`.

**Tech Stack:** As Plan 3. No new dependencies: Node 22's `fetch` and `process.loadEnvFile` cover HTTP and `.env`.

**Spec:** `docs/superpowers/specs/2026-09-19-3d-chess-simulator-design.md` (section 9, Art Pipeline). **Builds on:** `docs/superpowers/plans/2026-09-20-art-pipeline.md`.

## Meshy Facts This Plan Relies On

From Meshy's API documentation, read on 2026-09-20. Anything not listed here is not assumed.

- Base URL `https://api.meshy.ai`. Header `Authorization: Bearer <key>`. `GET /openapi/v1/balance` returns `{"balance": <number>}`.
- Create calls return `{"result": "<task id>"}`. Tasks poll at `GET <create path>/<id>`. Status is one of `PENDING`, `IN_PROGRESS`, `SUCCEEDED`, `FAILED`, `CANCELED`; `progress` is 0 to 100; `consumed_credits` is an integer; failures carry `task_error.message`.
- `POST /openapi/v1/text-to-image`: `prompt`, `ai_model` (`nano-banana` 3 credits, `nano-banana-2` 6, `nano-banana-pro` 9, plus `gpt-image-2*` at 9), `pose_mode` (`a-pose` or `t-pose`), `aspect_ratio`, `generate_multi_view`, `remove_background`. Result: `image_urls`.
- `POST /openapi/v1/image-to-3d`: `image_url` or `input_task_id` (a completed text-to-image task), `ai_model` (`meshy-6-lite`, `meshy-6`, `meshy-7.1`, `latest`), `should_remesh`, `topology`, `target_polycount` (100 to 300000), `should_texture`, `enable_pbr`, `pose_mode`. Result: `model_urls.glb`.
- `POST /openapi/v1/rigging`: `input_task_id` or `model_url` (glb facing +Z), `height_meters`. Needs a textured, humanoid model of at most 300,000 faces. Result: `result.rigged_character_glb_url`, plus walking and running clips only. 5 credits.
- `GET /openapi/v1/animations/library` (free) lists `{action_id, name, key, category, sub_category, preview_url}`, filterable by `search`, `category`, `sub_category`. `POST /openapi/v1/animations` takes `rig_task_id` and one `action_id`; the result is `result.animation_glb_url`. 3 credits per action. Only action 4 ("Attack") is named in the docs.
- Errors: body `{"message": ...}`; `401` bad key, `402` insufficient credits, `429` rate or queue limit (`RateLimitExceeded` or `NoMoreConcurrentTasks`). Limits: 20 requests per second; 10 concurrent tasks on the smallest listed plan.
- Not documented, so not assumed: image-to-3D credit cost, and how long result URLs stay downloadable.

## Global Constraints

- Everything from Plan 3's Global Constraints still applies (Node 20 or newer, TypeScript strict including `tools/`, `// @vitest-environment node` on every tool test, conventional commits, one commit per task).
- No test touches the network or reads a real key. The Meshy client takes an injected `fetch` and `sleep`.
- The key comes from the `MESHY_API_KEY` environment variable, loaded from a gitignored `.env`. It is never printed, logged, written to `jobs.json`, or included in an error message.
- Nothing spends credits unless the command has `--yes`. `--dry-run` never calls a create endpoint.
- Task ids are written to `jobs.json` immediately after creation and before any waiting.
- Every result file is downloaded as soon as its task succeeds.

## Decisions Where the Spec Is Silent or Ambiguous

1. **All Meshy, one vendor.** Concepts come from Meshy's own text-to-image, chained to image-to-3D by `input_task_id`. The concept image is downloaded for review before the 3D stage is run.
2. **The knight is a humanoid.** Meshy's rigging rejects non-humanoid models, so the default knight prompt is an armored warrior standing upright with a sword, not a horse. Rooks and pawns stay rigid, as the spec says. Both are plain fields in `design.json`.
3. **Action ids are not guessed.** `design.json` starts with `attack: 4` (documented) and the other four as `null`. The `animate` stage refuses to start until all five are set, and `art actions --search <word>` finds them for free.
4. **Cost control.** `--max-credits N` caps a run. Known costs (text-to-image by model, rigging 5, animation 3) are estimated before creating a task. An unknown cost (image-to-3D) runs its first task alone, then uses the reported `consumed_credits`. A cap is required with `--yes`.
5. **Resume, never repeat.** A stage skips a piece that already has a succeeded attempt; it resumes polling an attempt that was created but not finished; a failed attempt gets a new one (Meshy refunds failed tasks). `--again` forces a new attempt for a piece that already succeeded.
6. **Curation is selecting an attempt.** Each stage keeps its attempts per piece. Downstream stages use the selected attempt (default: the latest that succeeded). `art pick <set> <piece> <stage> <n>` changes it.
7. **Drop the base model's own clips.** A rigged file from Meshy contains walking and running clips whose names are not known in advance. Plan 3's normalizer fails on unmapped clips by design, so this plan adds an explicit `dropBaseClips` option (flag `--drop-base-clips`, `set.json` field `dropBaseClips`) that removes every clip already in the base model before the animation files are merged.
8. **Sounds carry over.** `init-set` copies the dev pack's three placeholder `.wav` files into the source folder and lists them in `design.json`, so replacing the dev set with real art does not silently drop sound.

## File Structure

```
tools/art/
  meshy/client.ts        MeshyClient (implements MeshyApi), MeshyError, MeshyTaskError
  meshy/api.ts           MeshyApi, TaskKind, request builders, result extractors
  design.ts              Design type, parseDesign, defaultDesign
  prompts.ts             buildPrompt(design, pieceKey)
  jobs.ts                Jobs (jobs.json state and attempt selection)
  budget.ts              Budget (estimates, cap, reserve/settle)
  pipeline.ts            planStage, runStage
  assemble.ts            assemble(dir) -> set.json
  init.ts                initSet(dir)
  cliGenerate.ts         handlers for init-set, balance, actions, generate, pick, assemble
  testing/fakeMeshy.ts   in-memory MeshyApi for tests
  (modify) normalize.ts, buildSet.ts, args.ts, cli.ts, README.md
.env.example             (modify) MESHY_API_KEY
```

---

### Task 1: `dropBaseClips`

**Files:** modify `tools/art/normalize.ts`, `tools/art/buildSet.ts`, `tools/art/args.ts`; tests in their existing test files.

**Behavior:** `NormalizeOptions.dropBaseClips?: boolean`. When true, every animation already in the base model is removed (with its channels and samplers, via `dropClip`) after the base is read and before `extraClips` are merged. `PieceSource.dropBaseClips` passes it through; the normalize CLI accepts `--drop-base-clips`. Export `dropClip` from `clips.ts` to reuse it.

**Tests:** a rigged fixture with clips `Walking` and `Running` and one extra `attack` file normalizes with `keep: ['attack']` and `dropBaseClips: true` to exactly `['attack']` with no orphaned accessors; the same input without the flag still throws the stray-clip error; `buildSet` honors the field; `parseNormalizeArgs` sets it from `--drop-base-clips`.

**Commit:** `feat(tools): let normalize drop a base model's own clips before merging`

### Task 2: The Meshy client

**Files:** create `tools/art/meshy/client.ts`, `tools/art/meshy/api.ts` (types only in this task), `tools/art/meshy/client.test.ts`.

**Interfaces:**
- `type TaskKind = 'text-to-image' | 'image-to-3d' | 'rigging' | 'animations'`
- `interface MeshyTask { id: string; status: 'PENDING'|'IN_PROGRESS'|'SUCCEEDED'|'FAILED'|'CANCELED'; progress?: number; consumed_credits?: number; task_error?: { message?: string }; [k: string]: unknown }`
- `interface MeshyApi { balance(): Promise<number>; create(kind: TaskKind, body: object): Promise<string>; wait(kind: TaskKind, id: string, opts?: { onProgress?: (p: number) => void }): Promise<MeshyTask>; download(url: string, destPath: string): Promise<void>; library(search?: string): Promise<LibraryAction[]> }`
- `class MeshyClient implements MeshyApi`, constructed with `{ apiKey, fetch?, sleep?, baseUrl?, pollMs?, timeoutMs?, maxRetries? }`.
- `class MeshyError extends Error { status: number }` and `class MeshyTaskError extends Error { taskId: string }`.

**Behavior:** every request sends the bearer header. A non-2xx response throws `MeshyError` with the body's `message` and a plain-language hint (`401`: check `MESHY_API_KEY`; `402`: out of credits). `429` is retried with exponential backoff up to `maxRetries` (default 5) using the injected `sleep`, then thrown. `5xx` is retried the same way. `wait` polls until `SUCCEEDED` and returns the task; `FAILED` or `CANCELED` throws `MeshyTaskError` carrying `task_error.message`; exceeding `timeoutMs` throws with the last status. `download` writes the file, creating folders, and throws on a non-2xx status. The key never appears in any message.

**Tests (fake `fetch` and `sleep`):** the header is sent; `create` returns the id; 401 and 402 messages; 429 then success retries with growing delays and gives up after the limit; polling walks `PENDING` to `IN_PROGRESS` to `SUCCEEDED` and reports progress; `FAILED` surfaces the task's message; timeout; download writes bytes to a nested path; a thrown error's message and `JSON.stringify` never contain the key.

**Commit:** `feat(tools): add the Meshy client with retry, polling and download`

### Task 3: Endpoint builders, extractors, and the fake

**Files:** extend `tools/art/meshy/api.ts`; create `tools/art/testing/fakeMeshy.ts`; tests `tools/art/meshy/api.test.ts`.

**Interfaces:** `textToImageBody(prompt, opts)`, `imageTo3dBody(inputTaskId, opts)`, `riggingBody(inputTaskId, heightMeters)`, `animationBody(rigTaskId, actionId)` return request bodies exactly as in "Meshy Facts". `resultUrl(kind, task): string` extracts `image_urls[0]`, `model_urls.glb`, `result.rigged_character_glb_url`, or `result.animation_glb_url`, and throws a clear error naming the kind and the keys it did find when the field is missing. `createFakeMeshy(opts?)` returns a `MeshyApi` plus inspection (`created`, `downloads`, `balance`) that succeeds every task after a configurable number of polls, can be told to fail a given kind or piece, records every body, and writes small fixture files on `download`.

**Tests:** each builder's exact body (including `input_task_id`, `pose_mode`, `target_polycount`, `should_texture`, `enable_pbr: false`); each extractor on realistic task JSON and on a task missing its field; the fake honors `MeshyApi` (a typed assignment) and can simulate a failure.

**Commit:** `feat(tools): add Meshy request builders, result extractors and a fake`

### Task 4: Design config and prompts

**Files:** create `tools/art/design.ts`, `tools/art/prompts.ts`, tests `design.test.ts`, `prompts.test.ts`.

**Interfaces:**
- `interface Design { id; name; version; sides: SetManifest['sides']; style: string; sideLook: Record<'w'|'b', string>; textToImageModel: string; imageTo3dModel: string; targetPolycount: number; credits: { imageTo3d: number | null }; heightMeters: number; pieces: Record<string, { subject: string; rigged: boolean; rotateY?: number }>; actions: Record<ClipName, number | null>; audio: Record<string, string> }`
- `defaultDesign(): Design` builds Angels vs Demons: all twelve keys, king, queen, bishop and knight rigged, rook and pawn rigid, `actions` with `attack: 4` and the rest `null`.
- `parseDesign(json): Design` validates and throws a `DesignError` naming the field (missing piece key, unknown key, non-positive polycount, action id not an integer or null, unknown side).
- `buildPrompt(design, pieceKey): string` joins style, the side's look, the piece subject, and fixed framing constraints (single figure, full body, centered, front view, plain background, standing on a small round base).

**Tests:** `defaultDesign` round-trips through `parseDesign`; each validation error names its field; prompts differ by side and by piece, contain the framing constraints, and the knight prompt describes a humanoid.

**Commit:** `feat(tools): add the set design config and prompt builder`

### Task 5: Job state and budget

**Files:** create `tools/art/jobs.ts`, `tools/art/budget.ts`, tests.

**Interfaces:**
- `type StageKey = 'concept' | 'model' | 'rig' | ClipName`
- `interface Attempt { taskId: string; status: TaskStatus; file: string | null; credits: number | null; error: string | null }`
- `class Jobs`: `static load(path)` (an absent file is empty, a corrupt one throws naming the path), `attempts(piece, stage)`, `add(piece, stage, attempt)`, `update(piece, stage, taskId, patch)`, `selected(piece, stage): Attempt | null` (the picked index, else the latest `SUCCEEDED`), `select(piece, stage, index)`, `totalCredits()`. Every mutation saves atomically (write a temp file, rename).
- `class Budget`: `constructor({ cap: number | null, known: Partial<Record<TaskKind, number>> })`, `estimate(kind): number | null`, `reserve(kind)` throws `BudgetError` when `spent + estimate > cap`, `settle(kind, actual)` records `actual` as the observed cost, `spent`.

**Tests:** persistence across a reload; the atomic write leaves no partial file; corrupt file error; selection rules; `totalCredits`; budget refuses over the cap, treats an unknown estimate as `null`, learns from `settle`, and has no limit when `cap` is `null`.

**Commit:** `feat(tools): add resumable job state and a credit budget`

### Task 6: The pipeline stages

**Files:** create `tools/art/pipeline.ts`, test `pipeline.test.ts`.

**Interfaces:** `type Stage = 'concept' | 'model' | 'rig' | 'animate'`; `interface StageContext { api: MeshyApi; design: Design; jobs: Jobs; dir: string; budget: Budget; only?: string[]; again?: boolean; concurrency?: number; log?: (line: string) => void }`; `planStage(stage, ctx): PlanItem[]` (piece, what would happen, estimated credits or `null`, or why it is skipped); `runStage(stage, ctx): Promise<StageReport>` (`created`, `resumed`, `skipped`, `failed`, `creditsSpent`).

**Behavior:**
- `concept` creates one text-to-image task per piece from `buildPrompt`, downloads the first image to `concepts/<piece>-<n>.png`.
- `model` needs a selected succeeded concept; creates image-to-3d from `input_task_id`, downloads the glb to `models/<piece>-<n>.glb`.
- `rig` covers rigged pieces only, needs a selected succeeded model, creates rigging, downloads to `rigged/<piece>-<n>.glb`.
- `animate` covers rigged pieces, needs a selected succeeded rig and every action id set (else it throws `DesignError` listing the unset clips and pointing at `art actions`), creates one animation task per clip, downloads to `anims/<piece>/<clip>-<n>.glb`.
- A missing prerequisite marks that piece "blocked" with the reason; it never throws for the whole run.
- Resume, skip, and `--again` follow Decision 5. Task ids are saved before waiting. A failed task is recorded with its message and does not stop other pieces. The `Budget` is reserved before each create and settled with `consumed_credits` after; the first task of a kind with an unknown estimate runs alone before the pool starts. Concurrency defaults to 2.

**Tests (against the fake):** each stage's request, file location and recorded attempt; prerequisites block cleanly; a rerun creates nothing; an attempt left `IN_PROGRESS` is resumed without a new create; a failed task is recorded, the others finish, and a rerun retries only the failed one; `--again` adds an attempt; `--only` limits scope; the budget stops a run at the cap with a clear report and creates no task beyond it; the unknown-cost first task runs alone; `planStage` calls no create; animate refuses with unset action ids and lists them.

**Commit:** `feat(tools): add the resumable concept, model, rig and animate stages`

### Task 7: Assemble

**Files:** create `tools/art/assemble.ts`, test `assemble.test.ts`.

**Behavior:** `assemble(dir)` reads `design.json` and `jobs.json` and writes `set.json` for `build-set`. A rigged piece uses its selected rigged glb, `keep` all five clips, `dropBaseClips: true`, and `clips` mapping each clip to its selected animation file. A rigid piece uses its selected model glb and no clips. `rotateY` and `audio` come from the design. It throws a `NormalizeError`-style message listing every piece missing a required result, and writes nothing in that case.

**Tests:** a fully generated fake project assembles into a `set.json` that `parseSetManifest`-compatible `buildSet` accepts end to end (using fixture glbs); each missing-result case is listed by piece and stage; nothing is written on failure.

**Commit:** `feat(tools): assemble generated results into set.json`

### Task 8: Commands, `init-set`, and `.env`

**Files:** create `tools/art/init.ts`, `tools/art/cliGenerate.ts`; modify `tools/art/cli.ts`, `.env.example`; tests `init.test.ts`, `cliGenerate.test.ts`.

**Commands** (all through `pnpm art`): `init-set <dir>` writes `design.json` from `defaultDesign()` and copies the dev pack's three `.wav` files if present, refusing to overwrite an existing `design.json`; `balance`; `actions [--search word]`; `generate <dir> --stage concept|model|rig|animate [--only a,b] [--again] [--dry-run] [--yes --max-credits N] [--concurrency N]`; `pick <dir> <piece> <stage> <n>`; `assemble <dir>`.

**Behavior:** `MESHY_API_KEY` is loaded with `process.loadEnvFile('.env')` when the file exists, and commands that need it fail with one line saying how to set it. `generate` without `--dry-run` and without `--yes` refuses and says so; with `--yes` and no `--max-credits` it refuses; it prints the balance first and refuses when the balance is below the known estimate. Output is one line per piece plus a credits summary. Errors are one line, never a stack trace, and never contain the key.

**Tests:** handlers against the fake `MeshyApi` (the client is injected): `init-set` output validates and never overwrites; `generate` refuses without `--yes`, refuses without a cap, dry-run creates nothing, a real run reports and records; `pick` changes the selection and rejects a bad index; `actions` prints matches; a missing key prints the setup line; a thrown `MeshyError` prints its message only.

**Commit:** `feat(tools): add the generate, pick, actions, balance and init-set commands`

### Task 9: Runbook and final verification

**Files:** modify `tools/art/README.md`.

Document the first-run protocol below and the file layout. Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm e2e`, and smoke the real CLI (`init-set`, `generate --dry-run`, a refusal without `--yes`) with no key present.

**Commit:** `docs(tools): document the Meshy runbook`

---

## First Live Run Protocol (needs your key and your approval at each step)

1. Create a key in Meshy's dashboard and put `MESHY_API_KEY=...` in `.env` (gitignored). Run `pnpm art balance`.
2. `pnpm art init-set art-src/angels-vs-demons`, then edit `design.json` (style, prompts, knight and rigging choices).
3. `pnpm art actions --search idle` (and `hit`, `die`, `victory`) and set the ids in `design.json`. Free.
4. **One concept:** `pnpm art generate art-src/angels-vs-demons --stage concept --only w-king --dry-run`, then with `--yes --max-credits 10`. Look at `concepts/w-king-1.png`. Re-roll with `--again` until you like it. This also confirms the response shapes against reality.
5. **One model:** the same for `--stage model --only w-king --yes --max-credits <cap>`. The first model task reveals the real image-to-3D cost. Inspect the glb.
6. **One full piece:** `rig`, then `animate` for `w-king`, then `pnpm art assemble` is not yet possible (needs all twelve), so normalize that one glb by hand with `pnpm art normalize ... --drop-base-clips --anim ...` and look at it in the app.
7. Only then run each stage for the remaining pieces, stage by stage, checking the concept images before spending on models.
8. `pnpm art assemble art-src/angels-vs-demons`, then `pnpm art build-set art-src/angels-vs-demons public/packs/sets/angels-vs-demons`.

## Done Criteria for Plan 3b

- `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm e2e` all pass; no test uses the network or a key.
- With no key set, `init-set`, `generate --dry-run`, `pick`, `assemble` (on fixtures) all work, and `generate --yes` refuses with one clear line.
- A run interrupted at any point resumes without creating a duplicate task.
- The plan's Meshy facts are re-checked against the first real responses (Protocol steps 4 to 6) and any mismatch is fixed in the extractors.

## Risks

- **Response shapes are from documentation, not from a real call.** Task 3's extractors throw a message naming the keys they did find, and Protocol step 4 spends 3 credits to confirm the first one before anything larger runs.
- **Result URL retention is undocumented.** Downloading immediately mitigates it; a rerun of `animate` after a long gap may find an expired rig, which the failure message will say.
- **Art quality is not testable.** Whether the angels look like angels, whether the rig deforms well, and whether an armored knight rigs cleanly are judged by eye, one piece at a time, before the batch.
- **Cost of curation.** Two or three attempts per piece is expected. The per-run cap and the one-piece-first protocol are the controls.
