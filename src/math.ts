export interface V3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: V3, n: number): V3 => v3(a.x * n, a.y * n, a.z * n);
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: V3): V3 => scale(a, 1 / Math.max(length(a), 1e-12));
export const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));
export const rad = (degrees: number): number => degrees * Math.PI / 180;
export const direction = (yaw: number, pitch: number): V3 => v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
export function random(seed: number): () => number {
  let n = seed >>> 0;
  return () => { n += 0x6d2b79f5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function gaussian(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-10))) * Math.cos(2 * Math.PI * rng());
}
