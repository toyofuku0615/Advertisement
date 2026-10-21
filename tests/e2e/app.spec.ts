import { test, expect, type Page } from '@playwright/test';

async function navigate(page:Page,label:string){
 const menu=page.getByRole('button',{name:'メニューを開く',exact:true});
 if(await menu.isVisible())await menu.click();
 await page.getByRole('navigation',{name:'メインナビゲーション'}).getByRole('button',{name:new RegExp('^'+label)}).click();
 await expect(page.locator('main h1')).toBeVisible();
}
async function archive(page:Page){await page.goto('/');await page.getByRole('button',{name:/^公式アーカイブ \d/}).click();await expect(page.locator('.evidence-card').first()).toBeVisible();}

// Fixtures in these tests are synthetic DEMO data. They are uploaded only into each
// isolated test browser's IndexedDB and are never included in public/data.
const geoDemo='date,region,value\n2025-01-01,JP,60\n2025-01-01,US,40\n2025-02-01,JP,80\n2025-02-01,US,50\n';
const surveyDemo='title,sourceUrl,fetchedAt,surveyDate,regionCode,age,gender,segment,population,sampleSize,question,value,unit,methodology,comparabilityKey\nDEMO E2E survey,https://www.e-stat.go.jp/,2025-02-01T00:00:00Z,2025-01-01,JP,20-29,all,student,DEMO test population,100,DEMO survey question,42,%,DEMO method,DEMO-wave-1\n';

test('all seven workspaces open with desktop/mobile navigation and no render errors',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('main h1')).toContainText('世界のいま');
 for(const label of ['AUDIENCE','SPREAD MAP','COMPARE','CREATIVE','INSIGHT LAB','BRIEF BUILDER','RADAR']){
  await navigate(page,label);await expect(page.getByText('画面を表示できませんでした',{exact:true})).toHaveCount(0);
 }
 await expect(page.locator('body')).toHaveJSProperty('scrollWidth',await page.locator('body').evaluate(el=>el.clientWidth));
 await page.screenshot({path:info.outputPath(`radar-${info.project.name}.png`),fullPage:true});expect(errors).toEqual([]);
});

test('real archive search, region/category filters and one-click provenance work',async({page})=>{
 await archive(page);
 await page.getByLabel('国・地域',{exact:true}).selectOption('JP');
 await page.getByLabel('カテゴリー',{exact:true}).selectOption('社会・ニュース');
 await page.getByLabel('話題を検索').fill('Climate');
 await expect(page.locator('.evidence-card')).toHaveCount(1);
 const card=page.locator('.evidence-card').first();await expect(card.locator('.topic-title')).toContainText('Climate');
 const origin=card.getByRole('link',{name:'原典を読む'});await expect(origin).toHaveAttribute('target','_blank');await expect(origin).toHaveAttribute('href',/githubusercontent\.com|github\.com/);
 await card.getByRole('button',{name:'出典・指標'}).click();await expect(card.locator('.evidence-details')).toContainText('取得日時');await expect(card.locator('.evidence-details')).toContainText('正規化');
 await page.getByLabel('話題を検索').fill('THIS_DOES_NOT_EXIST_314159');await expect(page.getByRole('heading',{name:'条件に合う観測はありません'})).toBeVisible();
 await page.getByRole('button',{name:'検索をクリア'}).click();await expect(page.locator('.evidence-card').first()).toBeVisible();
});

test('bookmark and editable research note survive reload',async({page})=>{
 await archive(page);const card=page.locator('.evidence-card').first();const title=await card.locator('.topic-title').innerText();
 await card.getByRole('button',{name:/を保存$/}).click();await expect(card.getByRole('button',{name:/を保存解除$/})).toBeVisible();
 await page.reload();await expect(page.locator('.evidence-card').first().getByRole('button',{name:/を保存解除$/})).toBeVisible();
 const menu=page.getByRole('button',{name:'メニューを開く',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:/保存したリサーチ/}).click();await expect(page.getByRole('dialog')).toContainText(title);
 await page.getByLabel('発見メモ').fill('DEMO E2E research note');await page.getByRole('button',{name:'メモを保存'}).click();
 await expect(page.getByRole('dialog')).toContainText('DEMO E2E research note');
 await page.reload();if(await menu.isVisible())await menu.click();await page.getByRole('button',{name:/保存したリサーチ/}).click();await expect(page.getByRole('dialog')).toContainText('DEMO E2E research note');
});

test('dark mode persists and data source failure states remain explicit',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'ダークモードに切り替え'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByRole('button',{name:'情報源の状態',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('情報源と収集状態');await expect(dialog.locator('.source-run')).not.toHaveCount(0);await expect(dialog).toContainText('無効・キー未設定');
});

test('real map renders, country details and observed-time animation work',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#map');await expect(page.locator('.map-canvas canvas')).toBeVisible();await expect(page.getByRole('button',{name:'地図をPNG出力',exact:true})).toBeEnabled();await expect(page.locator('#map-time')).toBeEnabled();
 await page.getByLabel('詳細を表示する地域').selectOption('FR');await expect(page.locator('.map-detail h2')).toContainText('フランス');await expect(page.locator('.map-detail')).toContainText('正規化');
 const before=await page.locator('.map-date-mark').innerText();await page.locator('#map-time').fill('2');await expect(page.locator('.map-date-mark')).not.toHaveText(before);
 await page.getByRole('button',{name:'時系列を再生'}).click();await expect(page.getByRole('button',{name:'時系列を停止'})).toBeVisible();await page.getByRole('button',{name:'時系列を停止'}).click();
 await expect(page.getByLabel('時系列の表示間隔')).toBeDisabled();await expect(page.locator('.map-method-note')).toContainText('国際的な人気順位には使えません');
 await page.getByRole('button',{name:'ニュース報道',exact:true}).click();await expect(page.locator('.map-empty-overlay')).toContainText('地域データはありません');await page.getByRole('button',{name:'検索関心',exact:true}).click();
 const png=page.waitForEvent('download');await page.getByRole('button',{name:'地図をPNG出力',exact:true}).click();expect((await png).suggestedFilename()).toMatch(/\.png$/);
 await page.screenshot({path:info.outputPath(`map-${info.project.name}.png`),fullPage:true});expect(errors).toEqual([]);
});

test('DEMO CSV import is confirmed, preserved and exported with source definitions',async({page})=>{
 await page.goto('/#map');await page.getByRole('button',{name:'CSVを取り込む',exact:true}).first().click();
 await page.getByLabel('地図CSVファイル').setInputFiles({name:'DEMO-e2e-geography.csv',mimeType:'text/csv',buffer:Buffer.from(geoDemo)});
 await page.getByLabel('CSVトピック名',{exact:true}).fill('DEMO E2E topic');await page.getByLabel('CSV正規化範囲').fill('DEMO test fixture / one joint export / same periods and regions');
 await page.getByRole('button',{name:'内容を検証'}).click();await expect(page.locator('.map-import-preview')).toContainText('4件の有効な観測');
 await page.getByRole('button',{name:'確認して取り込む'}).click();await expect(page.getByLabel('地図のトピック',{exact:true})).toHaveValue(/import-/);
 await page.locator('#map-time').fill('1');await expect(page.locator('.map-date-mark')).toHaveText('2025-02-01');
 await page.getByLabel('時系列の表示間隔').selectOption('month');await expect(page.getByLabel('時系列の表示間隔')).toHaveValue('month');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'地図データをCSV出力',exact:true}).click();expect((await download).suggestedFilename()).toBe('culture-radar-geo.csv');
 await page.reload();await page.getByLabel('地図のトピック',{exact:true}).selectOption({label:'DEMO E2E topic'});await expect(page.locator('#map-time')).toBeEnabled();
});

test('creative records support add, edit, export, search and deletion',async({page})=>{
 await page.goto('/#creative');await page.getByRole('button',{name:'URLを保存',exact:true}).click();
 await page.getByLabel('原典URL 必須').fill('https://www.facebook.com/ads/library/?id=DEMO-e2e');await page.getByLabel('ブランド 必須').fill('DEMO E2E brand');
 await page.getByLabel('最初の3秒').fill('DEMO close-up observation');await page.getByLabel('コピー',{exact:true}).fill('DEMO expression research');
 await page.getByRole('button',{name:'研究記録を保存'}).click();await expect(page.locator('.creative-card')).toHaveCount(1);await expect(page.locator('.creative-card')).toContainText('DEMO E2E brand');
 await page.getByRole('button',{name:'DEMO E2E brandの分析を編集'}).click();await page.getByLabel('ブランド 必須').fill('DEMO E2E edited');await page.getByRole('button',{name:'変更を保存',exact:true}).click();
 await page.getByLabel('クリエイティブを検索').fill('edited');await expect(page.locator('.creative-card')).toHaveCount(1);await page.getByLabel('クリエイティブのグループ分類').selectOption('emotion');
 const csv=page.waitForEvent('download');await page.getByRole('button',{name:'CSV',exact:true}).click();expect((await csv).suggestedFilename()).toMatch(/creatives.*\.csv$/);
 await page.reload();await expect(page.locator('.creative-card')).toContainText('DEMO E2E edited');await page.getByRole('button',{name:'DEMO E2E editedの記録を削除'}).click();await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.locator('.creative-card')).toHaveCount(0);
});

test('survey import retains provenance and does not infer other demographics',async({page})=>{
 await page.goto('/#audience');await page.locator('input[type=file]').setInputFiles({name:'DEMO-e2e-survey.csv',mimeType:'text/csv',buffer:Buffer.from(surveyDemo)});
 await expect(page.locator('.import-preview')).toContainText('1 件');await page.getByRole('button',{name:'確認して保存',exact:true}).click();await expect(page.locator('.survey-card')).toContainText('DEMO E2E survey');await expect(page.locator('.survey-card')).toContainText('n=100');
 await page.getByRole('combobox',{name:'年代',exact:true}).selectOption('40-49');await expect(page.getByRole('heading',{name:'属性別の実測データなし'})).toBeVisible();await expect(page.locator('.survey-card')).toHaveCount(0);
 await page.getByRole('combobox',{name:'年代',exact:true}).selectOption('20-29');await expect(page.locator('.survey-card')).toHaveCount(1);await expect(page.locator('.survey-card a')).toHaveAttribute('href','https://www.e-stat.go.jp/');
});

test('insight hypotheses keep evidence IDs through save, edit, reload and export',async({page})=>{
 await page.goto('/#insight');await page.getByRole('combobox',{name:'分析する話題',exact:true}).selectOption('archive-climate-variability-and-change');
 await expect(page.locator('.lab-section-title')).toHaveCount(9);
 await page.getByRole('textbox',{name:'自分の仮説・解釈',exact:true}).fill('DEMO E2E hypothesis: verify temporary exposure against persistent need.');
 await page.getByText('参照する根拠IDを選ぶ（0件）',{exact:true}).click();await page.locator('.lab-reference-checks input[type=checkbox]').first().check();
 const evidenceId=await page.locator('.lab-reference-checks small').first().innerText();await page.getByRole('button',{name:'仮説を保存',exact:true}).click();
 await expect(page.locator('.lab-saved-list')).toContainText('DEMO E2E hypothesis');await expect(page.locator('.lab-saved-list')).toContainText(evidenceId);
 await page.locator('.lab-saved-list').getByRole('button',{name:'編集',exact:true}).click();await page.getByRole('textbox',{name:'自分の仮説・解釈',exact:true}).fill('DEMO E2E edited hypothesis: seek counter-evidence.');await page.getByRole('button',{name:'仮説を更新',exact:true}).click();
 await page.reload();await expect(page.locator('.lab-saved-list')).toContainText('DEMO E2E edited hypothesis');await expect(page.locator('.lab-saved-list')).toContainText(evidenceId);
 const output=page.waitForEvent('download');await page.getByRole('button',{name:'分析をMarkdown出力'}).click();expect((await output).suggestedFilename()).toMatch(/insight.*\.md$/);
});

test('brief builder turns real evidence into an editable saved and exportable draft',async({page})=>{
 await page.goto('/#brief');await page.getByRole('textbox',{name:'ブランド名 *',exact:true}).fill('DEMO E2E client');
 await page.getByRole('textbox',{name:'商品の特徴・ブランドが提供できる価値 *',exact:true}).fill('DEMO reusable packaging; verify the actual benefit before making claims.');
 await page.getByRole('textbox',{name:'ターゲット *',exact:true}).fill('DEMO JP household research group');await page.getByRole('textbox',{name:'マーケティング課題 *',exact:true}).fill('DEMO reduce uncertainty when choosing reusable packaging.');
 await page.locator('.brief-topic-list input[type=checkbox]').first().check();await page.getByRole('button',{name:'検証用ドラフトを作る',exact:true}).click();
 const draft=page.getByRole('textbox',{name:'ブリーフ本文（Markdown）',exact:true});await expect(draft).toContainText('原典URL一覧');
 const content=await draft.inputValue();expect(content).toContain('DEMO E2E client');expect(content).toContain('生活者インサイト仮説');expect(content).toContain('検証方法');expect(content).toContain('https://github.com/googletrends/data/');
 await draft.fill(content+'\n\nDEMO E2E client review note');await page.getByRole('button',{name:'ブリーフを保存',exact:true}).click();await expect(page.locator('.brief-saved-list')).toContainText('DEMO E2E client');
 await page.reload();await page.locator('.brief-load').filter({hasText:'DEMO E2E client'}).click();await expect(draft).toContainText('DEMO E2E client review note');
 const output=page.waitForEvent('download');await page.getByRole('button',{name:'Markdown出力',exact:true}).click();expect((await output).suggestedFilename()).toMatch(/brief.*\.md$/);
});
