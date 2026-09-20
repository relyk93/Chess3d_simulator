import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import type { Mesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useActions, useController } from '../controller/context';
import { ALL_SQUARES, isDarkSquare, squareToWorld } from '../core/squares';
import type { Square } from '../core/types';
import { usePacks } from '../packs/context';
import { packUrl } from '../packs/loader';
import type { BoardManifest } from '../packs/types';
import { gltfCache, hdrCache } from './assets';
import { SELECTED_SQUARE_COLOR } from './colors';
import { createLavaMaterial } from './lavaMaterial';

/** Squares are drawn slightly smaller than 1.0 so the grooves between them show the lava cracks beneath. */
const SQUARE_VISUAL_SIZE = 0.94;

function squareColor(sq: Square, sel: Square | null, targets: Square[], occupied: Set<Square>, c: BoardManifest['squares']): string {
  if (sq === sel) return SELECTED_SQUARE_COLOR;
  if (targets.includes(sq)) return occupied.has(sq) ? c.capture : c.highlight;
  return isDarkSquare(sq) ? c.dark : c.light;
}

/** Plain slab used until the board model loads, or if the pack has none. */
function FallbackSlab() {
  return (
    <mesh position={[0, -0.15, 0]} receiveShadow>
      <boxGeometry args={[9, 0.3, 9]} />
      <meshStandardMaterial color="#1b1a1f" roughness={0.9} />
    </mesh>
  );
}

/** Slab and frame from the board glb. The mesh named `cracks` gets the lava shader, or is hidden if the pack asks for no ambient effect. */
function BoardModel({ gltf, ambient }: { gltf: GLTF; ambient: BoardManifest['ambient'] }) {
  const lava = useMemo(() => (ambient.type === 'lava-cracks' ? createLavaMaterial(ambient.intensity) : null), [ambient.type, ambient.intensity]);
  const root = useMemo(() => {
    const r = gltf.scene.clone(true);
    r.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      if (mesh.name === 'cracks') {
        if (lava) mesh.material = lava;
        else mesh.visible = false;
      }
    });
    return r;
  }, [gltf.scene, lava]);
  useFrame((state) => {
    if (lava) lava.uniforms.uTime!.value = state.clock.elapsedTime;
  });
  return <primitive object={root} />;
}

export function Board() {
  const { board } = usePacks();
  const m = board.manifest;
  const { clickSquare } = useActions();
  const selected = useController((s) => s.selected);
  const targets = useController((s) => s.legalTargets);
  const pieces = useController((s) => s.pieces);
  const occupied = useMemo(
    () => new Set(Object.values(pieces).filter((p) => !p.captured).map((p) => p.square)),
    [pieces],
  );
  const gltf = gltfCache.use(packUrl(board.baseUrl, m.model));
  const envMap = hdrCache.use(packUrl(board.baseUrl, m.environment));

  return (
    <group>
      {gltf ? <BoardModel gltf={gltf} ambient={m.ambient} /> : <FallbackSlab />}
      {envMap && <Environment map={envMap} environmentIntensity={0.5} />}
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
            <planeGeometry args={[SQUARE_VISUAL_SIZE, SQUARE_VISUAL_SIZE]} />
            <meshStandardMaterial color={squareColor(sq, selected, targets, occupied, m.squares)} roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}
