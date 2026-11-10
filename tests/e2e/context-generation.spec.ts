import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Fixed real collected headlines, served only inside the test browser. This does
// not create AI content or write a fake generated explanation to public/data.
const dataset = JSON.parse(readFileSync(new URL('../fixtures/context-dataset.json', import.meta.url), 'utf8'));
const topic = dataset.topics[0];
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(dataset.generatedAt) });
  await page.route('**/data/dataset.json', route => route.fulfill({ json: dataset }));
  await page.route('**/data/explanations.json', route => route.fulfill({ status: 404, json: { error: 'DEMO unavailable cache' } }));
});

test('a missing summary has a working manual AI handoff without calling an inference API', async ({ page }) => {
  let copied = '';
  await page.exposeFunction('recordCopiedContext', (value: string) => { copied = value; });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (value: string) => (window as unknown as { recordCopiedContext: (value: string) => Promise<void> }).recordCopiedContext(value) } });
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await page.getByRole('button', { name: `${topic.title}の文脈を読む`, exact: true }).click();
  const actions = page.getByRole('region', { name: 'この話題のAI要約を作る', exact: true });
  await expect(actions).toContainText('記事本文は含みません');
  await actions.getByRole('button', { name: 'AIに渡す原文をコピー', exact: true }).click();
  await expect(actions.getByRole('status')).toContainText('原文と要約の指示をコピーしました');
  expect(copied).toContain('背景の仮説');
  expect(copied).toContain('news-');
  expect(copied).toContain(dataset.observations[0].relatedLinks[0].title);
  expect(copied).toContain(dataset.observations[0].relatedLinks[0].url);
  await actions.getByText('この話題をPCで生成する', { exact: true }).click();
  await actions.getByRole('button', { name: '生成コマンドをコピー', exact: true }).click();
  await expect.poll(() => copied).toBe(`py scripts/pc_updater.py --once --topic-id ${topic.id}`);
  expect(requests.filter(url => /localhost:11434|127\.0\.0\.1:11434|api\.openai\.com/.test(url))).toEqual([]);
  expect(await page.locator('body').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
});

test('blocked clipboard leaves selectable source text instead of losing the action', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('DEMO clipboard blocked')) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: `${topic.title}の文脈を読む`, exact: true }).click();
  const actions = page.getByRole('region', { name: 'この話題のAI要約を作る', exact: true });
  await actions.getByRole('button', { name: 'AIに渡す原文をコピー', exact: true }).click();
  const fallback = actions.getByRole('textbox', { name: 'AI要約用の原文と指示', exact: true });
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute('readonly');
  expect(await fallback.inputValue()).toContain('取得した見出しのみ');
  await fallback.focus();
  expect(await fallback.evaluate(element => (element as HTMLTextAreaElement).selectionEnd - (element as HTMLTextAreaElement).selectionStart)).toBeGreaterThan(100);
});
