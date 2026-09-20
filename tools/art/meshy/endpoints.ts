import type { MeshyTask, TaskKind } from './api';
import { MeshyTaskError } from './client';

export type PoseMode = 'a-pose' | 't-pose';

export function textToImageBody(prompt: string, opts: { aiModel: string; poseMode?: PoseMode }) {
  return { prompt, ai_model: opts.aiModel, ...(opts.poseMode ? { pose_mode: opts.poseMode } : {}) };
}

/** Chains from a finished text-to-image task, so no image has to be hosted. Lean, textured, no PBR maps. */
export function imageTo3dBody(inputTaskId: string, opts: { aiModel: string; targetPolycount: number; poseMode?: PoseMode }) {
  return {
    input_task_id: inputTaskId,
    ai_model: opts.aiModel,
    topology: 'triangle',
    target_polycount: opts.targetPolycount,
    should_remesh: true,
    should_texture: true,
    enable_pbr: false,
    ...(opts.poseMode ? { pose_mode: opts.poseMode } : {}),
  };
}

export function riggingBody(inputTaskId: string, heightMeters: number) {
  return { input_task_id: inputTaskId, height_meters: heightMeters };
}

export function animationBody(rigTaskId: string, actionId: number) {
  return { rig_task_id: rigTaskId, action_id: actionId };
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function firstString(v: unknown): string | null {
  if (typeof v === 'string' && v !== '') return v;
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0] !== '') return v[0];
  return null;
}

const FIELD: Record<TaskKind, { name: string; read: (o: Obj) => string | null }> = {
  'text-to-image': { name: 'image_urls', read: (o) => firstString(o.image_urls) },
  'image-to-3d': { name: 'model_urls.glb', read: (o) => (isObj(o.model_urls) ? firstString(o.model_urls.glb) : null) },
  rigging: { name: 'rigged_character_glb_url', read: (o) => firstString(o.rigged_character_glb_url) },
  animations: { name: 'animation_glb_url', read: (o) => firstString(o.animation_glb_url) },
};

/**
 * The downloadable file of a succeeded task. Meshy's documentation puts image results at the top
 * level and rigging and animation results under `result`; both places are checked. If neither has
 * the field, the error lists what the response did contain, so a mismatch is easy to diagnose.
 */
export function resultUrl(kind: TaskKind, task: MeshyTask): string {
  const spec = FIELD[kind];
  const direct = spec.read(task);
  if (direct) return direct;
  if (isObj(task.result)) {
    const nested = spec.read(task.result);
    if (nested) return nested;
  }
  const found = Object.keys(task)
    .map((k) => (k === 'result' && isObj(task.result) ? `result (${Object.keys(task.result).join(', ')})` : k))
    .join(', ');
  throw new MeshyTaskError(`${kind} task ${task.id} succeeded but has no ${spec.name}; found: ${found}`, task.id);
}
