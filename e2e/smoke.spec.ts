import { expect, test } from '@playwright/test';

test('app mounts, engine loads, and a move gets a reply', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /new game/i })).toBeVisible();

  // Wait for Stockfish to finish its handshake.
  await page.waitForFunction(() => window.__chess3d?.getState().engineStatus === 'ready', null, { timeout: 15_000 });

  await page.evaluate(() => {
    const a = window.__chess3d!.getState().actions;
    a.clickSquare('e2');
    a.clickSquare('e4');
  });

  // Human move animates (350 ms), engine thinks (<= 2 s), reply animates.
  await page.waitForFunction(
    () => {
      const s = window.__chess3d!.getState();
      return s.history.length === 2 && s.phase === 'idle';
    },
    null,
    { timeout: 15_000 },
  );

  await expect(page.getByText('1.')).toBeVisible();
  expect(errors).toEqual([]);
});
