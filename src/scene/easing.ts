export const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
export const easeInQuad = (u: number): number => u * u;
export const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
