import { expect, type Page } from '@playwright/test';
import { Chess } from 'chess.js';

/*
 * Every waitForFunction here uses interval polling: the default polls on requestAnimationFrame, and under the
 * software WebGL headless Chromium uses, frames can be a second apart.
 */

/** Collects console errors and uncaught page errors so a test can assert there were none. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function openTwoPlayer(page: Page, settings: { cinematics: boolean } = { cinematics: true }): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__chess3dScene?.pieceIds().length ?? 0) === 32, null, { timeout: 15_000, polling: 100 });
  await page.evaluate((s) => window.__chess3d!.getState().actions.updateSettings({ twoPlayer: true, ...s }), settings);
}

export async function phase(page: Page): Promise<string> {
  return page.evaluate(() => window.__chess3d!.getState().phase);
}

export async function waitForPhase(page: Page, wanted: string, timeout = 10_000): Promise<void> {
  await page.waitForFunction((w) => window.__chess3d!.getState().phase === w, wanted, { timeout, polling: 50 });
}

/** Plays one SAN move as a human would: select, target, and pick a promotion piece through the store if asked. */
export async function playSan(page: Page, chess: Chess, san: string, promotionVia: 'store' | 'none' = 'store'): Promise<void> {
  const m = chess.move(san);
  await page.evaluate(([from, to]) => {
    const a = window.__chess3d!.getState().actions;
    a.clickSquare(from as never);
    a.clickSquare(to as never);
  }, [m.from, m.to]);
  if (m.promotion && promotionVia === 'store') {
    await waitForPhase(page, 'promoting');
    await page.evaluate((p) => window.__chess3d!.getState().actions.choosePromotion(p as never), m.promotion);
  }
  await page.waitForFunction(() => ['idle', 'gameOver'].includes(window.__chess3d!.getState().phase), null, { timeout: 15_000, polling: 50 });
}

/**
 * The scene is correct if every piece is drawn exactly where the controller says: captured pieces hidden,
 * everything else visible on its square. Returns the list of disagreements (empty when correct).
 */
export async function sceneMismatches(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const st = window.__chess3d!.getState();
    const snaps = window.__chess3dScene!.snapshotAll();
    const bad: string[] = [];
    for (const [id, p] of Object.entries(st.pieces)) {
      const s = snaps[id];
      if (!s) {
        bad.push(`${id}: no scene handle`);
        continue;
      }
      if (s.visible === p.captured) bad.push(`${id}: visible=${s.visible} but captured=${p.captured}`);
      const x = 'abcdefgh'.indexOf(p.square[0]!) - 3.5;
      const z = 3.5 - (Number(p.square[1]) - 1);
      if (!p.captured && (Math.abs(s.x - x) > 0.02 || Math.abs(s.z - z) > 0.02)) {
        bad.push(`${id}: drawn at (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) but controller says ${p.square}`);
      }
    }
    return bad;
  });
}

export async function expectSceneMatchesState(page: Page): Promise<void> {
  expect(await sceneMismatches(page)).toEqual([]);
}
