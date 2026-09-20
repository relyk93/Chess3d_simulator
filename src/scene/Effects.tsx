import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { AdditiveBlending, BufferAttribute, BufferGeometry } from 'three';
import { ParticleSystem } from './particles';
import { useSceneRegistry } from './sceneContext';

function ParticlePoints({ system }: { system: ParticleSystem }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(system.positions, 3));
    g.setAttribute('color', new BufferAttribute(system.colors, 3));
    return g;
  }, [system]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    system.update(Math.min(delta, 0.05));
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
  });
  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial size={0.09} vertexColors transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </points>
  );
}

/** Post-processing (bloom, subtle vignette) and the impact particle emitter the sequencer triggers. */
export function Effects() {
  const registry = useSceneRegistry();
  const system = useMemo(() => new ParticleSystem(), []);
  useEffect(() => registry.setEffects({ burst: (position, effect) => system.emit(position, effect) }), [registry, system]);
  return (
    <>
      <ParticlePoints system={system} />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.9} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.3} darkness={0.55} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
