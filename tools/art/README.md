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
