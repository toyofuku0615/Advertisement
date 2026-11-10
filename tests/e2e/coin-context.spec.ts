import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Actual collected headlines and actual Codex output, frozen only in test browsers.
// No fictional news or model mock is included in public/data.
const dataset = JSON.parse(readFileSync(new URL('../fixtures/coin-context-dataset.json', import.meta.url), 'utf8'));
const cache = JSON.parse(readFileSync(new URL('../fixtures/coin-context-explanations.json', import.meta.url), 'utf8'));

test('coin headlines become a cited Japanese summary with separate psychological hypotheses', async ({ page }, info) => {
  const modelRequests: string[] = [];
  page.on('request', request => { if (/11434|api\.openai\.com|generativelanguage/.test(request.url())) modelRequests.push(request.url()); });
  await page.clock.install({ time: new Date(cache.generatedAt) });
  await page.route('**/data/dataset.json', route => route.fulfill({ json: dataset }));
  await page.route('**/data/explanations.json', route => route.fulfill({ json: cache }));
  await page.goto('/');
  await page.getByRole('button', { name: 'coinの文脈を読む', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '「coin」の文脈', exact: true });
  await expect(dialog.locator('.context-what')).toContainText('古銭の売却');
  await expect(dialog.locator('.context-what')).toContainText('50ペンス');
  await expect(dialog.locator('.context-situations .context-situation')).toHaveCount(3);
  await expect(dialog.locator('.context-situations')).toContainText('出土品の売却');
  await expect(dialog.locator('.context-situations')).toContainText('高額取引');
  await expect(dialog.locator('.context-attention')).toContainText('AIの解釈・仮説');
  await expect(dialog.locator('.context-attention')).toContainText('実測した結果ではありません');
  await expect(dialog.locator('.context-headlines')).toContainText('記事本文は取得していません');
  await expect(dialog.locator('.context-headlines li')).toHaveCount(3);
  const citations = await dialog.locator('.context-what .context-citations a').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href));
  expect(citations).toEqual(cache.explanations[0].overview.evidenceIds.map((id: string) => cache.explanations[0].evidence.find((row: { id: string }) => row.id === id).url));
  await expect(dialog.locator('.context-generation')).toContainText('OpenAI Codex');
  expect(await page.locator('body').evaluate(body => body.scrollWidth > body.clientWidth)).toBe(false);
  expect(modelRequests).toEqual([]);
  await page.screenshot({ path: info.outputPath(`coin-context-${info.project.name}.png`), fullPage: true });
});
