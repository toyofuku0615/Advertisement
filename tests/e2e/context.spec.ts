import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Dataset, ExplanationBundle } from '../../src/types';

const DATASET_PATH = new URL('../../public/data/dataset.json', import.meta.url);
const EXPLANATIONS_PATH = new URL('../../public/data/explanations.json', import.meta.url);
const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8')) as Dataset;
const bigArch = dataset.topics.find(topic => topic.title === '빅아치');
if (!bigArch) throw new Error('The real Korean Big Arch observation is required to test Japanese contextual discovery.');
const topicTitle = bigArch.title;
const topicId = bigArch.id;
function bundle(): ExplanationBundle { return JSON.parse(readFileSync(EXPLANATIONS_PATH, 'utf8')) as ExplanationBundle; }
async function findTopic(page: Page) {
  await page.goto('/');
  await expect(page.locator('.evidence-card').first()).toBeVisible();
  await page.getByLabel('話題を検索', { exact: true }).fill(topicTitle);
  await expect(page.locator('.evidence-card')).toHaveCount(1);
  return page.locator('.evidence-card').first();
}
async function openContext(page: Page) {
  const card = await findTopic(page);
  await card.getByRole('button', { name: `${topicTitle}の文脈を読む`, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}

// These tests use the actual source-grounded production cache. Mutated data below
// is explicitly DEMO data delivered only by test-browser request interception.
// No test mock is written to public/data or sent to an external inference API.
test('real Japanese AI context connects a foreign trend to cited original headlines without browser AI calls', async ({ page }, info) => {
  const requested: string[] = []; const runtimeErrors: string[] = [];
  page.on('request', request => requested.push(request.url()));
  page.on('pageerror', error => runtimeErrors.push(error.message));
  const entry = bundle().explanations.find(item => item.topicId === topicId);
  expect(entry?.status).toBe('ready'); expect(entry?.overview.text).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  const card = await findTopic(page);
  await expect(card.locator('.context-card-summary.has-explanation')).toContainText('何の話？');
  await expect(card.locator('.context-card-summary')).toContainText(entry!.overview.text);
  await card.getByRole('button', { name: `${topicTitle}の文脈を読む`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '何の話？', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'どんな場面で使われる？', exact: true })).toBeVisible();
  await expect(dialog.locator('.context-what .context-kind')).toHaveText('原典情報のAI要約');
  await expect(dialog.locator('.context-attention .context-kind')).toHaveText('AIの解釈・仮説');
  await expect(dialog.locator('.context-headlines')).toContainText('取得した原文');
  const citation = dialog.locator('.context-what .context-citations a').first();
  await expect(citation).toHaveAttribute('target', '_blank');
  await expect(citation).toHaveAttribute('href', /^https:\/\//);
  const citationUrl = new URL((await citation.getAttribute('href'))!).href;
  expect(entry!.evidence.some(evidence => new URL(evidence.url).href === citationUrl)).toBe(true);
  await expect(dialog.locator('.context-generation')).toContainText(entry!.provider);
  await dialog.locator('.context-evidence summary').click();
  await expect(dialog.locator('.context-evidence code').first()).toContainText(entry!.evidence[0].id);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
  await card.getByRole('button', { name: `${topicTitle}の文脈を読む`, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('dialog').locator('.context-what')).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath(`context-${info.project.name}.png`), fullPage: true });
  expect(runtimeErrors).toEqual([]);
  expect(requested.filter(url => /api\.openai\.com|generativelanguage\.googleapis\.com|models\.github\.ai|localhost:11434|127\.0\.0\.1:11434/.test(url))).toEqual([]);
  expect(requested.filter(url => /explanations\.json(?:\?|$)/.test(url)).length).toBeGreaterThan(0);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});

test('Insight keeps the context introduction separate from the original nine analysis stages', async ({ page }) => {
  await page.goto('/#insight');
  await page.getByRole('combobox', { name: '分析する話題', exact: true }).selectOption(topicId);
  const context = page.getByRole('region', { name: `${topicTitle}の文脈解説`, exact: true });
  await expect(context.locator('.context-what')).toBeVisible();
  await expect(page.locator('.lab-section-title')).toHaveCount(9);
  expect(await context.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('.lab-section-title')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.lab-section-title').first()).toContainText('観測された事実');
});

test('a Japanese explanation keyword discovers the actual Korean topic', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.context-card-summary.has-explanation').first()).toBeVisible();
  await page.getByLabel('話題を検索', { exact: true }).fill('マクドナルド');
  await expect(page.locator('.evidence-card').filter({ hasText: topicTitle })).toHaveCount(1);
  await expect(page.locator('.evidence-card').filter({ hasText: topicTitle }).locator('.context-card-summary')).toContainText('マクドナルド');
});

test('missing AI cache preserves usable Radar and links to real headline context', async ({ page }) => {
  const runtimeErrors: string[] = []; page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route('**/data/explanations.json', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'DEMO E2E cache unavailable' }) }));
  const dialog = await openContext(page);
  await expect(dialog.locator('.context-unavailable')).toContainText('AI解説を読み込めませんでした');
  await expect(dialog.locator('.context-headlines li a').first()).toHaveAttribute('target', '_blank');
  await expect(dialog.locator('.context-headlines')).toContainText('取得した原文');
  await expect(dialog.locator('.context-ready-label')).toHaveCount(0);
  await expect(dialog.locator('.context-what')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('changed evidence hides cached claims until the reader explicitly opens the older explanation', async ({ page }) => {
  const data = bundle(); const item = data.explanations.find(entry => entry.topicId === topicId)!;
  item.inputHash = '0'.repeat(64);
  item.overview.text = 'DEMO E2E 更新前の説明。現在の話題として表示しない。';
  await page.route('**/data/explanations.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }));
  const dialog = await openContext(page);
  await expect(dialog.locator('.context-unavailable')).toContainText('原典が更新された');
  const oldOverview = dialog.locator('.context-old-explanation .context-what .context-claim p');
  await expect(oldOverview).toContainText(item.overview.text);
  await expect(oldOverview).toBeHidden();
  await expect(dialog.locator('.context-headlines')).toContainText('取得した原文');
  await dialog.locator('.context-old-explanation summary').first().click();
  await expect(oldOverview).toBeVisible();
  await expect(dialog.locator('.context-generation')).toContainText('更新前のAI解説');
});

test('an invented citation invalidates the cache without breaking the underlying observations', async ({ page }) => {
  const data = bundle(); const item = data.explanations.find(entry => entry.topicId === topicId)!;
  item.overview.evidenceIds = ['DEMO-E2E-invented-evidence'];
  const runtimeErrors: string[] = []; page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route('**/data/explanations.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }));
  const dialog = await openContext(page);
  await expect(dialog.locator('.context-unavailable')).toContainText('AI解説を読み込めませんでした');
  await expect(dialog.locator('.context-ready-label')).toHaveCount(0);
  await expect(dialog.locator('.context-headlines li')).not.toHaveCount(0);
  await expect(page.getByText('画面を表示できませんでした', { exact: true })).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('an unavailable generation provider does not erase valid already-generated explanations', async ({ page }) => {
  const data = bundle(); data.providerStatus = { ...data.providerStatus, status: 'error', message: 'DEMO E2E generator unavailable; retain valid saved context' };
  await page.route('**/data/explanations.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }));
  const dialog = await openContext(page);
  await expect(dialog.locator('.context-ready-label')).toHaveText('AI解説');
  await expect(dialog.locator('.context-what')).toBeVisible();
  await expect(dialog.locator('.context-unavailable')).toHaveCount(0);
  await expect(dialog.locator('.context-headlines')).toContainText('取得した原文');
});

test('a CSV-only topic keeps its original source available before any AI explanation exists', async ({ page }) => {
  // DEMO fixture imported only into this isolated browser, never public/data.
  const name = 'DEMO E2E CSV-only context';
  const original = 'https://trends.google.com/trends/explore?q=DEMO-E2E';
  await page.goto('/#map');
  await page.getByRole('button', { name: 'CSVを取り込む', exact: true }).first().click();
  await page.getByLabel('地図CSVファイル').setInputFiles({ name: 'DEMO-context-only.csv', mimeType: 'text/csv', buffer: Buffer.from('date,region,value\n2025-01-01,JP,40\n2025-02-01,JP,50\n') });
  await page.getByLabel('CSVトピック名', { exact: true }).fill(name);
  await page.getByLabel('CSV原典URL', { exact: true }).fill(original);
  await page.getByLabel('CSV正規化範囲', { exact: true }).fill('DEMO fixture: one export, same region and two observed periods');
  await page.getByRole('button', { name: '内容を検証', exact: true }).click();
  await expect(page.locator('.map-import-preview')).toContainText('2件の有効な観測');
  await page.getByRole('button', { name: '確認して取り込む', exact: true }).click();
  const menu = page.getByRole('button', { name: 'メニューを開く', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'メインナビゲーション' }).getByRole('button', { name: /^INSIGHT LAB/ }).click();
  const context = page.getByRole('region', { name: `${name}の文脈解説`, exact: true });
  await expect(context).toBeVisible();
  await expect(context.locator('.context-unavailable')).toContainText('この話題のAI解説はまだありません');
  await expect(context.locator('.context-original-link')).toHaveAttribute('href', original);
  await expect(context.getByText('文脈を確認できる原典・関連記事がまだありません。AIによる説明は生成していません。', { exact: true })).toHaveCount(0);
});
