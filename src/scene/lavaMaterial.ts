import { ShaderMaterial } from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Flowing emissive noise. Output goes above 1.0 on purpose so the bloom pass picks it up, hence toneMapped: false.
const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = vUv * 18.0;
    vec2 flow = vec2(uTime * 0.15, -uTime * 0.1);
    float n = fbm(p + flow + fbm(p * 0.7 - flow) * 1.5);
    float heat = smoothstep(0.25, 0.85, n);
    vec3 deep = vec3(0.35, 0.02, 0.0);
    vec3 hot = vec3(1.0, 0.45, 0.08);
    vec3 color = mix(deep, hot, heat) * (1.2 + 2.0 * heat) * uIntensity * 1.6;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createLavaMaterial(intensity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: intensity } },
    vertexShader,
    fragmentShader,
    toneMapped: false,
  });
}
