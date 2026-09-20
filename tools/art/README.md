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

# Generating a set with Meshy

`pnpm art generate` drives Meshy to make the whole set: a concept image, a 3D model, a rig, and five
animation clips per rigged piece. It never spends credits unless you pass `--yes --max-credits N`,
and it can be stopped and restarted at any time without paying twice.

## What each stage makes

| Stage | Meshy call | Cost (Meshy's docs) | Saved to |
|---|---|---|---|
| `concept` | text-to-image, from the prompt in `design.json` | 3 credits (`nano-banana`) | `concepts/<piece>-<n>.png` |
| `model` | image-to-3D, from the chosen concept | not documented; the first task reports it | `models/<piece>-<n>.glb` |
| `rig` | auto-rigging, from the chosen model (rigged pieces only) | 5 credits | `rigged/<piece>-<n>.glb` |
| `animate` | one animation task per clip (rigged pieces only) | 3 credits each | `anims/<piece>/<clip>-<n>.glb` |

Rigged pieces are the king, queen, bishop and knight on both sides (8). Rooks and pawns are rigid and
use the engine's fallback motion. All of it lives under `art-src/<set-id>/`, which is gitignored.
`<n>` is the attempt number: every re-roll is kept so you can compare them.

## One-time setup

1. Create an API key in Meshy's dashboard. Put `MESHY_API_KEY=your_key` in a file named `.env` in the
   repository root (copy `.env.example`). `.env` is gitignored. The key is never printed or saved.
2. `pnpm art balance` shows your credits and proves the key works.
3. `pnpm art init-set art-src/angels-vs-demons` writes `design.json` and copies the dev pack's three
   placeholder sounds so the finished set is not silent. Edit `design.json`: the style, each side's
   look, each piece's subject, `rigged` per piece, and `targetPolycount`. The knight defaults to an
   armored humanoid because Meshy cannot rig a horse; switch it to `"rigged": false` for a horse.
4. Look up animation ids (free): `pnpm art actions --search idle`, and again for `hit`, `die` and
   `victory`. Put the ids in `design.json` under `actions`. Only `attack` (4) is filled in.

## The first run, one piece at a time

Do not run a whole stage first. Prove each step on `w-king` and look at it.

```bash
SET=art-src/angels-vs-demons

# 1. Preview, then make one concept (3 credits). Open concepts/w-king-1.png.
pnpm art generate $SET --stage concept --only w-king --dry-run
pnpm art generate $SET --stage concept --only w-king --yes --max-credits 5
#    Not right? Re-roll it (another 3 credits), then choose which one to use:
pnpm art generate $SET --stage concept --only w-king --again --yes --max-credits 5
pnpm art pick $SET w-king concept 2

# 2. One model. The first task of this kind runs alone and shows what image-to-3D really costs.
pnpm art generate $SET --stage model --only w-king --yes --max-credits 60
pnpm exec gltf-transform inspect $SET/models/w-king-1.glb

# 3. One rig, then its five clips.
pnpm art generate $SET --stage rig --only w-king --yes --max-credits 10
pnpm art generate $SET --stage animate --only w-king --yes --max-credits 20
```

To see that one piece in the game before doing the rest, normalize it and drop it over the dev pack's
`w-king` (its manifest already lists all five clips), then run `pnpm dev`:

```bash
pnpm art normalize --piece w-king --in $SET/rigged/w-king-1.glb \
  --out public/packs/sets/angels-vs-demons/models/w-king.glb \
  --keep idle,attack,hit,die,victory --drop-base-clips \
  --anim idle=$SET/anims/w-king/idle-1.glb --anim attack=$SET/anims/w-king/attack-1.glb \
  --anim hit=$SET/anims/w-king/hit-1.glb --anim die=$SET/anims/w-king/die-1.glb \
  --anim victory=$SET/anims/w-king/victory-1.glb
git checkout public/packs    # put the dev piece back when you are done looking
```

If the piece lunges backward in a capture, the model faces the wrong way: add `"rotateY": 180` to
that piece in `design.json`. If a step fails, the message says why; fix the cause and run it again.

## The rest

Once one piece looks right, run each stage for everything, one stage at a time, checking the concepts
before paying for models. Stages skip what is already done, so re-running is safe.

```bash
pnpm art generate $SET --stage concept --yes --max-credits 40
#   review concepts/*.png; re-roll any with --only <piece> --again, and pick the best
pnpm art generate $SET --stage model   --yes --max-credits 300
pnpm art generate $SET --stage rig     --yes --max-credits 50
pnpm art generate $SET --stage animate --yes --max-credits 150
pnpm art assemble $SET
pnpm art build-set $SET public/packs/sets/angels-vs-demons
```

`assemble` writes `set.json` from your chosen attempts and lists every piece that is still missing
something. `build-set` normalizes all twelve and writes the pack, and after that `pnpm dev-packs`
will refuse to overwrite it.

## Safety rules

- `--dry-run` shows what a run would do and cost, and needs no key. It creates nothing.
- Without `--yes` nothing is created. `--yes` also needs `--max-credits`, and a run stops before it
  would pass that number. If a kind of task has no known cost yet (image-to-3D before its first run),
  the first task runs alone, and its reported cost is used for the rest.
- The balance is checked before a run, and a run the balance cannot cover is refused.
- Every task id is saved to `jobs.json` the moment it exists. If a run is interrupted, or a download
  fails after Meshy has already charged, running the same command picks the task up again. It does not
  create a second one. A task Meshy reports as failed is refunded, and the next run makes a new one.
- A `401`, `402` or `429` from Meshy stops the whole run at once instead of retrying every piece.
- Results are downloaded as soon as they finish, because Meshy does not document how long links last.

## When something goes wrong

| You see | What it means | What to do |
|---|---|---|
| `MESHY_API_KEY is not set` | No key in the environment or `.env` | Add it to `.env` |
| `Meshy 401` | Meshy rejected the key | Check the key in `.env` |
| `Meshy 402` | Out of credits | Top up, then rerun; finished work is kept |
| `Meshy 429` after retries | Too many tasks at once | Rerun with `--concurrency 1` |
| `no action id for ...` | `design.json` still has `null` action ids | `pnpm art actions --search <word>` |
| `succeeded but has no <field>; found: ...` | Meshy's response differs from its docs | The task is paid for and stays open. Send the `found:` list; it is a one-line fix in `tools/art/meshy/endpoints.ts`, then rerun to collect it |
| `no succeeded concept yet` | A stage needs the one before it | Run the earlier stage first |
