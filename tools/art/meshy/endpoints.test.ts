// @vitest-environment node
import { animationBody, imageTo3dBody, resultUrl, riggingBody, textToImageBody } from './endpoints';

describe('request bodies', () => {
  test('text-to-image sends the prompt and model, and a pose only when asked', () => {
    expect(textToImageBody('a king', { aiModel: 'nano-banana' })).toEqual({ prompt: 'a king', ai_model: 'nano-banana' });
    expect(textToImageBody('a king', { aiModel: 'nano-banana', poseMode: 'a-pose' })).toEqual({
      prompt: 'a king',
      ai_model: 'nano-banana',
      pose_mode: 'a-pose',
    });
  });

  test('image-to-3d chains from the concept task and asks for a lean textured triangle mesh', () => {
    expect(imageTo3dBody('concept-1', { aiModel: 'latest', targetPolycount: 15000 })).toEqual({
      input_task_id: 'concept-1',
      ai_model: 'latest',
      topology: 'triangle',
      target_polycount: 15000,
      should_remesh: true,
      should_texture: true,
      enable_pbr: false,
    });
    expect(imageTo3dBody('c', { aiModel: 'latest', targetPolycount: 9000, poseMode: 'a-pose' }).pose_mode).toBe('a-pose');
  });

  test('rigging chains from the model task', () => {
    expect(riggingBody('model-1', 1.7)).toEqual({ input_task_id: 'model-1', height_meters: 1.7 });
  });

  test('an animation is one action on one rig', () => {
    expect(animationBody('rig-1', 4)).toEqual({ rig_task_id: 'rig-1', action_id: 4 });
  });
});

describe('resultUrl', () => {
  const base = { id: 't1', status: 'SUCCEEDED' as const };

  test('text-to-image takes the first image', () => {
    expect(resultUrl('text-to-image', { ...base, image_urls: ['https://a/1.png', 'https://a/2.png'] })).toBe('https://a/1.png');
  });

  test('image-to-3d takes the glb', () => {
    expect(resultUrl('image-to-3d', { ...base, model_urls: { glb: 'https://a/m.glb', fbx: 'https://a/m.fbx' } })).toBe('https://a/m.glb');
  });

  test('rigging takes the rigged character glb from result', () => {
    expect(resultUrl('rigging', { ...base, result: { rigged_character_glb_url: 'https://a/r.glb' } })).toBe('https://a/r.glb');
  });

  test('animations take the animation glb from result', () => {
    expect(resultUrl('animations', { ...base, result: { animation_glb_url: 'https://a/an.glb' } })).toBe('https://a/an.glb');
  });

  test('image results are also found under result, in case the docs are loose about nesting', () => {
    expect(resultUrl('text-to-image', { ...base, result: { image_urls: ['https://a/x.png'] } })).toBe('https://a/x.png');
    expect(resultUrl('image-to-3d', { ...base, result: { model_urls: { glb: 'https://a/y.glb' } } })).toBe('https://a/y.glb');
  });

  test('a succeeded task with no usable field names the kind, the task and the keys it did find', () => {
    expect(() => resultUrl('rigging', { ...base, result: { basic_animations: {} } })).toThrow(
      /rigging task t1 succeeded but has no rigged_character_glb_url; found: id, status, result \(basic_animations\)/,
    );
    expect(() => resultUrl('text-to-image', { ...base, image_urls: [] })).toThrow(/text-to-image task t1 succeeded but has no image_urls/);
  });
});
