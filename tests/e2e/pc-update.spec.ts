import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A copy of the real snapshot is intercepted inside isolated test browsers only.
// The changed publication timestamp and DEMO notes never enter public/data.
const published = JSON.parse(readFileSync(new URL('../../public/data/dataset.json', import.meta.url), 'utf8'));
const nextPublication = '2026-10-22T03:04:00Z';

test('PC update guide explains Windows setup and smartphone limits without pretending to run Ollama', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '自動更新の設定ガイド', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'PCで更新、スマホで読む', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('標準では6時間ごと');
  await expect(dialog).toContainText('電源が切れたPCやスリープ中のPCは起動できません');
  await expect(dialog).toContainText('この画面からPCの設定状態・稼働状態は確認できません');
  await expect(dialog.getByRole('link', { name: 'Windows PCでの設定手順を開く' })).toHaveAttribute('href', 'https://github.com/toyofuku0615/Advertisement/blob/main/docs/PC_UPDATES.md');
  expect(await page.locator('body').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(requests.filter(url => /localhost:11434|127\.0\.0\.1:11434|api\.openai\.com/.test(url))).toEqual([]);
});

test('returning to the app revalidates published data once and preserves filters and research drafts', async ({ page }) => {
  let reads = 0;
  let updated = false;
  await page.clock.install({ time: new Date('2026-10-22T03:00:00Z') });
  await page.route('**/data/dataset.json', async route => {
    reads++;
    await route.fulfill({ json: updated ? { ...published, generatedAt: nextPublication } : published });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^公式アーカイブ \d/ }).click();
  await page.getByLabel('国・地域', { exact: true }).selectOption('JP');
  await page.getByLabel('話題を検索').fill('Climate');
  await expect(page.locator('.evidence-card')).toHaveCount(1);
  const baselineReads = reads;

  const menu = page.getByRole('button', { name: 'メニューを開く', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: /保存したリサーチ/ }).click();
  await page.getByLabel('発見メモ').fill('DEMO saved note before returning');
  await page.getByRole('button', { name: 'メモを保存' }).click();
  await page.getByLabel('発見メモ').fill('DEMO unsaved draft remains open');

  updated = true;
  await page.clock.fastForward(61_000);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => reads).toBe(baselineReads + 1);
  await expect(page.getByLabel('発見メモ')).toHaveValue('DEMO unsaved draft remains open');
  await expect(page.getByRole('dialog')).toContainText('DEMO saved note before returning');
  await page.keyboard.press('Escape');
  // Close the mobile navigation left beneath the research dialog, if present.
  if (await page.getByRole('button', { name: 'メニューを閉じる' }).isVisible()) {
    await page.getByRole('button', { name: 'メニューを閉じる' }).click();
  }
  await expect(page.getByLabel('話題を検索')).toHaveValue('Climate');
  await expect(page.getByLabel('国・地域', { exact: true })).toHaveValue('JP');
  await expect(page.locator('.evidence-card')).toHaveCount(1);
  await page.getByRole('button', { name: '自動更新の設定ガイド', exact: true }).click();
  await expect(page.locator('.pc-update-status')).toContainText('2026/10/22 12:04');
  expect(reads).toBe(baselineReads + 1);
});

test('a failed resume fetch keeps the previous good snapshot and current search usable', async ({ page }) => {
  let failing = false;
  let reads = 0;
  await page.clock.install({ time: new Date('2026-10-22T03:00:00Z') });
  await page.route('**/data/dataset.json', async route => {
    reads++;
    if (failing) await route.fulfill({ status: 503, body: 'DEMO temporary source failure' });
    else await route.fulfill({ json: published });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^公式アーカイブ \d/ }).click();
  await page.getByLabel('国・地域', { exact: true }).selectOption('JP');
  await page.getByLabel('話題を検索').fill('Climate');
  await expect(page.locator('.evidence-card')).toHaveCount(1);
  const title = await page.locator('.topic-title').innerText();
  const baselineReads = reads;
  failing = true;
  await page.clock.fastForward(61_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => reads).toBe(baselineReads + 1);
  await expect(page.locator('.notice.warning').first()).toContainText('HTTP 503');
  await expect(page.getByLabel('話題を検索')).toHaveValue('Climate');
  await expect(page.locator('.evidence-card')).toHaveCount(1);
  await expect(page.locator('.topic-title')).toHaveText(title);
  await expect(page.getByRole('heading', { name: 'データを読み込めませんでした' })).toHaveCount(0);
});
