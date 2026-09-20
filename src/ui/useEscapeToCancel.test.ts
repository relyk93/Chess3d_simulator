import { fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useEscapeToCancel } from './useEscapeToCancel';

test('Escape calls onCancel while active', () => {
  const onCancel = vi.fn();
  renderHook(() => useEscapeToCancel(true, onCancel));
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('does nothing while inactive, and stops listening after unmount', () => {
  const onCancel = vi.fn();
  const inactive = renderHook(() => useEscapeToCancel(false, onCancel));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onCancel).not.toHaveBeenCalled();
  inactive.unmount();
  const active = renderHook(() => useEscapeToCancel(true, onCancel));
  active.unmount();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onCancel).not.toHaveBeenCalled();
});
