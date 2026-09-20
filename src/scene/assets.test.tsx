import { renderHook, waitFor } from '@testing-library/react';
import { createAssetCache } from './assets';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('returns null while loading, then the asset', async () => {
  const d = deferred<string>();
  const cache = createAssetCache<string>(() => d.promise);
  const { result } = renderHook(() => cache.use('/a.glb'));
  expect(result.current).toBeNull();
  d.resolve('model');
  await waitFor(() => expect(result.current).toBe('model'));
});

test('an empty url never loads and returns null', () => {
  const load = vi.fn(() => Promise.resolve('x'));
  const cache = createAssetCache<string>(load);
  const { result } = renderHook(() => cache.use(''));
  expect(result.current).toBeNull();
  expect(load).not.toHaveBeenCalled();
});

test('many consumers share one load', async () => {
  const load = vi.fn(() => Promise.resolve('shared'));
  const cache = createAssetCache<string>(load);
  const a = renderHook(() => cache.use('/a.glb'));
  const b = renderHook(() => cache.use('/a.glb'));
  await waitFor(() => expect(a.result.current).toBe('shared'));
  await waitFor(() => expect(b.result.current).toBe('shared'));
  expect(load).toHaveBeenCalledTimes(1);
});

test('a failure warns once for all consumers, returns null, and is not retried', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn(() => Promise.reject(new Error('404')));
  const cache = createAssetCache<string>(load);
  const a = renderHook(() => cache.use('/missing.glb'));
  const b = renderHook(() => cache.use('/missing.glb'));
  await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  expect(a.result.current).toBeNull();
  expect(b.result.current).toBeNull();
  a.rerender();
  expect(load).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toContain('/missing.glb');
  warn.mockRestore();
});

test('a consumer that mounts after the asset is ready gets it immediately', async () => {
  const cache = createAssetCache<string>(() => Promise.resolve('ready'));
  const first = renderHook(() => cache.use('/a.glb'));
  await waitFor(() => expect(first.result.current).toBe('ready'));
  const late = renderHook(() => cache.use('/a.glb'));
  expect(late.result.current).toBe('ready');
  expect(cache.peek('/a.glb')).toBe('ready');
});

test('unmounting before the load finishes does not throw', async () => {
  const d = deferred<string>();
  const cache = createAssetCache<string>(() => d.promise);
  const { unmount } = renderHook(() => cache.use('/a.glb'));
  unmount();
  d.resolve('late');
  await Promise.resolve();
});
