// 無障礙與互動回歸測試：npm run test:a11y
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const today = new Date();
const d = (off) => { const x = new Date(today.getFullYear(), today.getMonth(), Math.min(28, today.getDate()) - off); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const SEED = {
  tx: [
    { id: 1, type: 'income', amount: 60000, cat: '薪資', note: '本月薪水', date: d(0) },
    { id: 2, type: 'expense', amount: 4200, cat: '飲食', note: '午餐 <b>x</b>', date: d(0) },
    { id: 3, type: 'expense', amount: 9000, cat: '居住', note: '房租', date: d(0) },
  ],
  budget: { '飲食': 4000, '居住': 20000 },
  assets: [{ id: 5, name: '銀行存款', val: 200000 }, { id: 6, name: '信貸', val: -50000 }],
  invest: [{ id: 7, name: '台積電 2330', qty: 1000, cost: 600, now: 1050 }],
  future: [{ id: 8, type: 'expense', name: '汽車保險', amount: 30000, cat: '保險', rep: 'yearly', date: d(0), end: '' }],
};
const VIEWS = ['dash', 'add', 'list', 'budget', 'assets', 'invest', 'future', 'cloud'];

for (const scheme of ['light', 'dark']) {
  test.describe(`axe (${scheme})`, () => {
    test.use({ colorScheme: scheme });
    for (const v of VIEWS) {
      test(`view ${v} 無 WCAG 2.2 AA 違規`, async ({ page }) => {
        await page.addInitScript((seed) => localStorage.setItem('finbook_db_v1', JSON.stringify(seed)), SEED);
        await page.goto('/');
        await page.click(`#tab-${v}`);
        await page.waitForTimeout(400);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(r.violations.map(x => `${x.id}: ${x.nodes.map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      });
    }
  });
}

test('mobile 版面無 axe 違規', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => localStorage.setItem('finbook_db_v1', JSON.stringify(seed)), SEED);
  await page.goto('http://127.0.0.1:4173/');
  for (const v of ['dash', 'add', 'list', 'budget']) {
    await page.click(`#tab-${v}`);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map(x => `${v} ${x.id}: ${x.nodes.map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  }
  await ctx.close();
});

test.describe('互動', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((seed) => { if (!localStorage.getItem('finbook_db_v1')) localStorage.setItem('finbook_db_v1', JSON.stringify(seed)); }, SEED);
    page.on('pageerror', (e) => { throw e; });
    await page.goto('/');
  });

  test('方向鍵切換分頁並更新 aria-selected', async ({ page }) => {
    await page.focus('#tab-dash');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-add')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-add')).toHaveClass(/active/);
  });

  test('彈窗：焦點移入、Esc 關閉並還原焦點', async ({ page }) => {
    await page.click('#tab-add');
    await page.click('#catManageBtn');
    await expect(page.locator('#catNew')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#catModal')).toBeHidden();
    await expect(page.locator('#catManageBtn')).toBeFocused();
  });

  test('記帳：分類 chips、記完聚焦金額、使用者輸入已跳脫', async ({ page }) => {
    await page.click('#tab-add');
    await expect(page.locator('#f-amt')).toBeFocused();
    await page.click('#typeSeg button[data-type="expense"]');
    await expect(page.locator('#typeSeg button[data-type="expense"]')).toHaveAttribute('aria-pressed', 'true');
    await page.fill('#f-amt', '123');
    await expect(page.locator('#f-amt-hint')).toHaveText('約 $123');
    await page.click('#f-cat-chips .chip:has-text("交通")');
    await page.fill('#f-note', '<img src=x onerror=alert(1)>');
    await page.click('#addBtn');
    await expect(page.locator('#toast')).toContainText('已記一筆支出');
    await expect(page.locator('#f-amt')).toBeFocused();
    await page.click('#tab-list');
    await expect(page.locator('#txBody img')).toHaveCount(0);
    await expect(page.locator('#txBody')).toContainText('<img src=x');
  });

  test('空金額顯示欄位錯誤並聚焦', async ({ page }) => {
    await page.click('#tab-add');
    await page.click('#addBtn');
    await expect(page.locator('#f-amt')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#f-amt-err')).toBeVisible();
    await expect(page.locator('#f-amt')).toBeFocused();
  });

  test('明細：篩選與刪除後可復原', async ({ page }) => {
    await page.click('#tab-list');
    await expect(page.locator('#txBody tr')).toHaveCount(3);
    await page.fill('#fl-q', '房租');
    await expect(page.locator('#txBody tr')).toHaveCount(1);
    await page.fill('#fl-q', '');
    await page.locator('#txBody [data-del]').first().click();
    await expect(page.locator('#txBody tr')).toHaveCount(2);
    await page.click('#toast button');
    await expect(page.locator('#txBody tr')).toHaveCount(3);
  });

  test('總覽：預算提醒、資料表、圖表有花紋與替代文字', async ({ page }) => {
    await expect(page.locator('#budAlert')).toContainText('飲食 已超支');
    await expect(page.locator('#chBar')).toHaveAttribute('aria-label', /近 6 個月/);
    await page.locator('details.dt summary').first().click();
    await expect(page.locator('details.dt table').first()).toBeVisible();
  });
});
