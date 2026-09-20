import { expect, test } from '@playwright/test';
import { Chess } from 'chess.js';
import { expectSceneMatchesState, openTwoPlayer, phase, playSan, trackErrors, waitForPhase } from './helpers';

const CAPTURE_OPENING = ['e4', 'd5', 'exd5'];

test.describe('with the dev packs', () => {
  test('mounts with all 32 pieces and no console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await openTwoPlayer(page);
    await page.waitForTimeout(1500); // let the glb models stream in
    await expectSceneMatchesState(page);
    expect(errors).toEqual([]);
  });

  test('a capture plays the 3.9 s cinematic, then the scene matches the controller', async ({ page }) => {
    const errors = trackErrors(page);
    await openTwoPlayer(page);
    const chess = new Chess();
    for (const san of CAPTURE_OPENING.slice(0, 2)) await playSan(page, chess, san);
    await page.evaluate(() => {
      const w = window as unknown as { __marks: Record<string, number> };
      w.__marks = {};
      window.__chess3d!.subscribe((s, prev) => {
        if (s.phase === 'cinematic' && prev.phase !== 'cinematic') w.__marks.start = performance.now();
        if (prev.phase === 'cinematic' && s.phase !== 'cinematic') w.__marks.end = performance.now();
      });
    });
    await playSan(page, chess, 'exd5');
    const ms = await page.evaluate(() => {
      const m = (window as unknown as { __marks: Record<string, number> }).__marks;
      return m.end! - m.start!;
    });
    expect(ms).toBeGreaterThan(3600);
    expect(ms).toBeLessThan(5500);
    await expectSceneMatchesState(page);
    expect(errors).toEqual([]);
  });

  test('skipping settles the scene immediately', async ({ page }) => {
    await openTwoPlayer(page);
    const chess = new Chess();
    for (const san of ['e4', 'd5']) await playSan(page, chess, san);
    await page.evaluate(() => {
      const a = window.__chess3d!.getState().actions;
      a.clickSquare('e4');
      a.clickSquare('d5');
    });
    await waitForPhase(page, 'cinematic');
    await page.waitForTimeout(800);
    // Click and read back in one synchronous step: under software WebGL the main thread can be busy for a second at a
    // time, so a wall-clock budget would test the harness, not the skip.
    const after = await page.evaluate(() => {
      (document.querySelector('.skip') as HTMLButtonElement).click();
      return window.__chess3d!.getState().phase;
    });
    expect(after).toBe('idle');
    await expectSceneMatchesState(page);
  });

  test('undo after a capture brings the victim back on screen', async ({ page }) => {
    await openTwoPlayer(page, { cinematics: false });
    const chess = new Chess();
    for (const san of CAPTURE_OPENING) await playSan(page, chess, san);
    await expectSceneMatchesState(page);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expectSceneMatchesState(page);
    expect(await page.evaluate(() => Object.values(window.__chess3d!.getState().pieces).filter((p) => p.captured).length)).toBe(0);
  });

  test('castle, 3D-picker promotion and checkmate; new game restores the scene', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await openTwoPlayer(page, { cinematics: false });
    const chess = new Chess();
    const game = ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'e6', 'cxb7', 'Nf6'];
    for (const san of game) await playSan(page, chess, san);
    // Promotion: the in-scene picker is up, the HTML dialog is not.
    await page.evaluate(() => {
      const a = window.__chess3d!.getState().actions;
      a.clickSquare('b7');
      a.clickSquare('a8');
    });
    await waitForPhase(page, 'promoting');
    await expect(page.getByRole('dialog', { name: 'Choose promotion' })).toHaveCount(0);
    chess.move('bxa8=Q');
    await page.evaluate(() => window.__chess3d!.getState().actions.choosePromotion('q'));
    await waitForPhase(page, 'idle');
    for (const san of ['Be7', 'Nf3', 'O-O', 'Be2', 'Nbd7', 'O-O', 'Kh8', 'Ne5', 'Rg8', 'Nxf7#']) await playSan(page, chess, san);
    expect(await phase(page)).toBe('gameOver');
    await expectSceneMatchesStateExceptLoser(page);
    // The losing king dies and fades during the checkmate orbit.
    await page.waitForFunction(() => window.__chess3dScene!.snapshotAll()['b-k-0']?.visible === false, null, { timeout: 5000, polling: 100 });
    await page.getByRole('button', { name: 'New Game' }).first().click();
    await waitForPhase(page, 'idle');
    await expectSceneMatchesState(page);
    expect(errors).toEqual([]);
  });

  test('a model that fails to load shows a placeholder, warns once, and play continues', async ({ page }) => {
    const warnings: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('w-queen.glb')) warnings.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('**/w-queen.glb', (r) => r.abort());
    await openTwoPlayer(page, { cinematics: false });
    await page.waitForTimeout(2000);
    expect(warnings).toHaveLength(1);
    const chess = new Chess();
    for (const san of ['e4', 'e5', 'Qh5']) await playSan(page, chess, san); // the queen with the missing model moves
    await expectSceneMatchesState(page);
    expect(pageErrors).toEqual([]);
  });
});

test('with no packs at all the game is still playable on placeholders', async ({ page }) => {
  await page.route('**/packs/{sets,boards}/**', (r) => r.abort());
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await openTwoPlayer(page, { cinematics: true });
  const chess = new Chess();
  for (const san of ['e4', 'd5', 'exd5']) await playSan(page, chess, san);
  await expectSceneMatchesState(page);
  expect(pageErrors).toEqual([]);
});

test('WebGL context loss shows the reload overlay and promotion falls back to the HTML dialog', async ({ page }) => {
  await openTwoPlayer(page, { cinematics: false });
  const chess = new Chess();
  for (const san of ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'e6', 'cxb7', 'Nf6']) await playSan(page, chess, san);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGL2RenderingContext;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.getByRole('alert')).toContainText('Graphics context lost');
  await page.evaluate(() => {
    const a = window.__chess3d!.getState().actions;
    a.clickSquare('b7');
    a.clickSquare('a8');
  });
  await expect(page.getByRole('dialog', { name: 'Choose promotion' })).toBeVisible();
  await page.getByRole('button', { name: 'Queen' }).click();
  await page.waitForFunction(() => window.__chess3d!.getState().history.at(-1)?.promotion === 'q', null, { polling: 100 });
});

/** After checkmate the losing king may be mid-fade, so ignore just that piece. */
async function expectSceneMatchesStateExceptLoser(page: import('@playwright/test').Page): Promise<void> {
  const { sceneMismatches } = await import('./helpers');
  const bad = (await sceneMismatches(page)).filter((m) => !m.startsWith('b-k-0'));
  expect(bad).toEqual([]);
}
