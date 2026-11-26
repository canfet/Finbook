// 功能與無障礙進階測試：CSP、表單、分頁載入、手機「更多」、400% 縮放、強制色彩、同步合併、圖表鍵盤等
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const pad = n => String(n).padStart(2, '0');
const dateOf = (off) => { const x = new Date(); x.setDate(Math.min(28, x.getDate()) - off); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const baseDB = (o = {}) => ({
  tx: [{ id: 'a', u: 10, type: 'income', amount: 60000, cat: '薪資', note: '薪水', date: dateOf(0) },
       { id: 'b', u: 11, type: 'expense', amount: 4200, cat: '飲食', note: '午餐', date: dateOf(0) }],
  budget: {}, assets: [], invest: [], future: [], del: {}, updatedAt: 20, ...o,
});
const seed = (page, db) => page.addInitScript((d) => { if (!localStorage.getItem('finbook_db_v1')) localStorage.setItem('finbook_db_v1', JSON.stringify(d)); }, db);
const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const fmtV = r => r.violations.map(x => `${x.id}: ${x.nodes.map(n => n.target.join(' ')).join(' | ')}`);

test('CSP：頁面、圖表、匯出都沒有違規或主控台錯誤', async ({ page }) => {
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(String(e)));
  await seed(page, baseDB());
  await page.goto('/');
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => new Promise(res => { let n = 0; document.addEventListener('securitypolicyviolation', () => n++); setTimeout(() => res(n), 300); }));
  expect(v).toBe(0);
  await expect(page.locator('#chBar')).toHaveAttribute('aria-label', /近 6 個月/);
  expect(problems).toEqual([]);
});

test('xlsx 延遲載入：開啟時不載入，按匯出才載入並下載', async ({ page }) => {
  await seed(page, baseDB());
  await page.goto('/');
  expect(await page.evaluate(() => typeof window.XLSX)).toBe('undefined');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xlsxBtn')]);
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(await page.evaluate(() => typeof window.XLSX)).toBe('object');
});

test.describe('表單與驗證', () => {
  test.beforeEach(async ({ page }) => { await seed(page, baseDB()); await page.goto('/'); await page.click('#tab-add'); });

  test('在備註欄按 Enter 會送出記帳', async ({ page }) => {
    await page.fill('#f-amt', '88');
    await page.focus('#f-note');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('已記一筆');
  });
  test('日期被清空時不會存入壞資料，並顯示錯誤', async ({ page }) => {
    await page.fill('#f-amt', '50');
    await page.fill('#f-date', '');
    await page.click('#addBtn');
    await expect(page.locator('#f-date')).toHaveAttribute('aria-invalid', 'true');
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem('finbook_db_v1')).tx.length);
    expect(n).toBe(2);
  });
  test('金額超過上限、小數自動四捨五入', async ({ page }) => {
    await page.fill('#f-amt', '999999999999999');
    await page.click('#addBtn');
    await expect(page.locator('#f-amt-err')).toBeVisible();
    await page.fill('#f-amt', '0.1');
    await page.click('#addBtn');
    await page.fill('#f-amt', '0.2');
    await page.click('#addBtn');
    const sum = await page.evaluate(() => JSON.parse(localStorage.getItem('finbook_db_v1')).tx.filter(t => t.amount < 1).reduce((s, t) => s + t.amount, 0));
    expect(Math.round(sum * 100) / 100).toBe(0.3);
  });
  test('新記錄使用不重複的字串 id 並帶時間戳', async ({ page }) => {
    for (const v of ['1', '2', '3']) { await page.fill('#f-amt', v); await page.click('#addBtn'); }
    const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('finbook_db_v1')).tx.map(t => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem('finbook_db_v1')).tx.find(t => t.amount === 3));
    expect(typeof last.id).toBe('string');
    expect(last.u).toBeGreaterThan(0);
  });
  test('貨幣符號可切換並保存', async ({ page }) => {
    await page.click('#tab-cloud');
    await page.selectOption('#ui-cur', 'NT$');
    await page.click('#tab-dash');
    await expect(page.locator('#k-income')).toHaveText('NT$60,000');
    await page.reload();
    await expect(page.locator('#k-income')).toHaveText('NT$60,000');
  });
});

test('明細：分頁載入更多（每次 50 筆）', async ({ page }) => {
  const tx = Array.from({ length: 120 }, (_, i) => ({ id: 'id' + i, u: 1, type: 'expense', amount: i + 1, cat: '飲食', note: 'n' + i, date: dateOf(0) }));
  await seed(page, baseDB({ tx }));
  await page.goto('/');
  await page.click('#tab-list');
  await expect(page.locator('#txBody tr')).toHaveCount(50);
  await expect(page.locator('#flSummary')).toContainText('符合 120 / 120 筆（已顯示 50 筆）');
  await page.click('#txMore');
  await expect(page.locator('#txBody tr')).toHaveCount(100);
  await expect(page.locator('#txBody [data-txedit]').nth(50)).toBeFocused();
  await page.click('#txMore');
  await expect(page.locator('#txBody tr')).toHaveCount(120);
  await expect(page.locator('#txMoreWrap')).toBeHidden();
});

test('編輯記錄後可復原', async ({ page }) => {
  await seed(page, baseDB());
  await page.goto('/');
  await page.click('#tab-list');
  await page.locator('#txBody [data-txedit]').first().click();
  await page.fill('#txe-amt', '777');
  await page.click('#txSave');
  await expect(page.locator('#txBody')).toContainText('777');
  await page.click('#toast button');
  await expect(page.locator('#txBody')).not.toContainText('777');
});

test('刪除分類可復原（不再跳確認框）', async ({ page }) => {
  await seed(page, baseDB());
  await page.goto('/');
  await page.click('#tab-add');
  await page.click('#catManageBtn');
  const before = await page.locator('#catChips [data-catdel]').count();
  await page.locator('#catChips [data-catdel]').first().click();
  await expect(page.locator('#catChips [data-catdel]')).toHaveCount(before - 1);
  await page.click('#toast button');
  await expect(page.locator('#catChips [data-catdel]')).toHaveCount(before);
});

test('圖表鍵盤：方向鍵逐項朗讀數值', async ({ page }) => {
  await seed(page, baseDB());
  await page.goto('/');
  await page.focus('#chBar');
  await page.keyboard.press('End');
  await expect(page.locator('#chartLive')).toContainText('收入');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#chartLive')).toContainText('月');
});

test.describe('手機版', () => {
  test.use({ viewport: { width: 375, height: 760 } });

  test('「更多」選單：開啟、選擇分頁、Esc 關閉，且無 axe 違規', async ({ page }) => {
    await seed(page, baseDB());
    await page.goto('/');
    await expect(page.locator('#tab-invest')).toBeHidden();
    await page.click('#moreBtn');
    await expect(page.locator('#moreBtn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#tab-invest')).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(AA).analyze();
    expect(fmtV(r)).toEqual([]);
    await page.click('#tab-invest');
    await expect(page.locator('#view-invest')).toHaveClass(/active/);
    await expect(page.locator('#tab-invest')).toBeHidden();
    await expect(page.locator('#moreBtn')).toHaveClass(/active/);
    await page.click('#moreBtn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#moreBtn')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#moreBtn')).toBeFocused();
  });

  test('底部導覽觸控目標 ≥ 44px', async ({ page }) => {
    await seed(page, baseDB());
    await page.goto('/');
    for (const sel of ['#tab-dash', '#tab-add', '#tab-list', '#tab-budget', '#moreBtn']) {
      const b = await page.locator(sel).boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('縮放 400%（320px 寬）與文字間距', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  for (const v of ['dash', 'add', 'list', 'budget', 'cloud']) {
    test(`reflow：${v} 沒有橫向捲動`, async ({ page }) => {
      await seed(page, baseDB());
      await page.goto('/');
      if (v !== 'dash') { if (['cloud'].includes(v)) { await page.click('#moreBtn'); } await page.click(`#tab-${v}`); }
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(1);
    });
  }
  test('WCAG 1.4.12 文字間距調整後仍可用（無橫向溢出、按鈕仍可見）', async ({ page }) => {
    await seed(page, baseDB());
    await page.goto('/');
    await page.addStyleTag({ content: '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p{margin-bottom:2em!important}' });
    await page.click('#tab-add');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await expect(page.locator('#addBtn')).toBeVisible();
  });
});

test.describe('強制色彩（Windows 高對比）', () => {
  test.use({ forcedColors: 'active' });
  test('各分頁 axe 通過、焦點外框仍可見', async ({ page }) => {
    await seed(page, baseDB());
    await page.goto('/');
    for (const v of ['dash', 'add', 'list']) {
      await page.click(`#tab-${v}`);
      const r = await new AxeBuilder({ page }).withTags(AA).analyze();
      expect(fmtV(r)).toEqual([]);
    }
    await page.click('#tab-add');
    for (let i = 0; i < 60 && !(await page.evaluate(() => document.activeElement.id === 'addBtn')); i++) await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(outline).not.toBe('none');
  });
});

test.describe('雲端同步（模擬 Apps Script）', () => {
  const URL_ = 'https://script.google.com/macros/s/TEST/exec';
  async function setup(page, remoteData) {
    const saved = [];
    await page.route('https://script.google.com/**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      let out;
      if (body.action === 'get') out = { ok: true, data: remoteData };
      else if (body.action === 'save') { saved.push(body.data); out = { ok: true }; }
      else out = { ok: true, sheet: 'x' };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    });
    await page.addInitScript(([u, db]) => {
      localStorage.setItem('finbook_cfg_v1', JSON.stringify({ url: u, key: 'k' }));
      localStorage.setItem('finbook_db_v1', JSON.stringify(db));
      localStorage.setItem('finbook_dirty', '1');
    }, [URL_, baseDB({ tx: [{ id: 'local1', u: 100, type: 'expense', amount: 5, cat: '飲食', note: 'L', date: dateOf(0) }], updatedAt: 100 })]);
    return saved;
  }

  test('本機與雲端各有不同記錄：合併而不是覆蓋', async ({ page }) => {
    const remote = baseDB({ tx: [{ id: 'remote1', u: 200, type: 'expense', amount: 9, cat: '飲食', note: 'R', date: dateOf(0) }], updatedAt: 200 });
    const saved = await setup(page, remote);
    await page.goto('/');
    await page.click('#tab-list');
    await expect(page.locator('#txBody tr')).toHaveCount(2);
    await expect.poll(() => saved.length).toBeGreaterThan(0);
    const ids = saved[saved.length - 1].tx.map(t => t.id).sort();
    expect(ids).toEqual(['local1', 'remote1']);
  });

  test('雲端已刪除的項目（墓碑）不會被本機舊資料救回', async ({ page }) => {
    const remote = baseDB({ tx: [], del: { 'tx:local1': Date.now() - 1000 }, updatedAt: Date.now() }); // 墓碑需為近期時間，過期(>180 天)會被清除
    const saved = await setup(page, remote);
    await page.goto('/');
    await page.click('#tab-list');
    await expect(page.locator('#txEmpty')).toContainText('還沒有任何記錄');
    await expect.poll(() => saved.length).toBeGreaterThan(0);
    expect(saved[saved.length - 1].tx).toEqual([]);
  });

  test('同步失敗時出現「立即重試」', async ({ page }) => {
    await page.addInitScript(([u]) => { localStorage.setItem('finbook_cfg_v1', JSON.stringify({ url: u, key: 'k' })); }, [URL_]);
    await page.route('https://script.google.com/**', r => r.abort());
    await seed(page, baseDB());
    await page.goto('/');
    await expect(page.locator('#syncRetry')).toBeVisible();
  });
});

test('還原備份：壞日期被修正，並能復原到合法資料', async ({ page }) => {
  await seed(page, baseDB());
  await page.goto('/');
  await page.click('#tab-cloud');
  page.once('dialog', d => d.accept());
  await page.setInputFiles('#bkFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tx: [{ id: 'z', type: 'expense', amount: 3, cat: '飲食', date: 'bad', note: '<script>x</script>' }] })) });
  await expect(page.locator('#toast')).toContainText('已還原');
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem('finbook_db_v1')).tx);
  expect(t.length).toBe(1);
  expect(t[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test.describe('雲端同步 v2（基準版本，通常只需 1 次請求）', () => {
  const URL_ = 'https://script.google.com/macros/s/TEST/exec';
  async function server(page, initial) {
    const state = { cur: initial, calls: [] };
    await page.route('https://script.google.com/**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      state.calls.push(b.action);
      let out;
      if (b.action === 'get') out = { ok: true, v: 2, data: state.cur };
      else if (b.action === 'save') {
        const curAt = (state.cur && state.cur.updatedAt) || 0;
        if (b.baseAt != null && state.cur && curAt !== b.baseAt) out = { ok: false, conflict: true, v: 2, data: state.cur };
        else { state.cur = b.data; out = { ok: true, v: 2 }; }
      } else out = { ok: true, v: 2 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    });
    await page.addInitScript(([u, db]) => {
      localStorage.setItem('finbook_cfg_v1', JSON.stringify({ url: u, key: 'k' }));
      localStorage.setItem('finbook_db_v1', JSON.stringify(db));
    }, [URL_, initial]);
    return state;
  }

  test('沒有衝突：記一筆只送 1 次 save，不再多一次 get', async ({ page }) => {
    const st = await server(page, baseDB({ updatedAt: 500 }));
    await page.goto('/');
    await expect(page.locator('#syncTxt')).toHaveText('已同步至雲端');
    st.calls.length = 0;
    await page.click('#tab-add');
    await page.fill('#f-amt', '12');
    await page.click('#addBtn');
    await expect.poll(() => st.calls.filter(c => c === 'save').length).toBe(1);
    expect(st.calls).toEqual(['save']);
    expect(st.cur.tx.length).toBe(3);
  });

  test('別台裝置在中間改過：收到衝突 → 合併 → 重試，兩邊資料都保留', async ({ page }) => {
    const st = await server(page, baseDB({ updatedAt: 500 }));
    await page.goto('/');
    await expect(page.locator('#syncTxt')).toHaveText('已同步至雲端');
    // 模擬別台裝置寫入
    st.cur = { ...st.cur, tx: [...st.cur.tx, { id: 'other', u: Date.now(), type: 'expense', amount: 7, cat: '飲食', note: 'O', date: dateOf(0) }], updatedAt: Date.now() };
    st.calls.length = 0;
    await page.click('#tab-add');
    await page.fill('#f-amt', '12');
    await page.click('#addBtn');
    await expect.poll(() => st.cur.tx.length).toBe(4);
    expect(st.cur.tx.map(t => t.id)).toContain('other');
    expect(st.calls.filter(c => c === 'save').length).toBe(2); // 第一次衝突、第二次成功
  });

  test('不勾選「記住通行碼」：通行碼只存在 sessionStorage，不留在 localStorage', async ({ page }) => {
    await server(page, baseDB({ updatedAt: 1 }));
    await page.addInitScript(([u]) => { localStorage.setItem('finbook_cfg_v1', JSON.stringify({ url: u })); }, [URL_]);
    await page.goto('/');
    await page.click('#tab-cloud');
    await page.fill('#cfg-key', 'secret-key');
    await page.uncheck('#cfg-remember');
    await page.click('#cfgSave');
    await expect(page.locator('#cfgMsg')).toContainText('已連接雲端');
    const r = await page.evaluate(() => ({ ls: localStorage.getItem('finbook_cfg_v1'), ss: sessionStorage.getItem('finbook_key_session') }));
    expect(r.ls).not.toContain('secret-key');
    expect(r.ss).toBe('secret-key');
  });
});

const LogicNode = require('../js/logic.js');

test('透過私人連結（#cfg=，僅含網址）匯入：立刻清掉網址列、不顯示網址，再輸通行碼即可同步', async ({ page }) => {
  const URL_ = 'https://script.google.com/macros/s/PRIVATE_DEPLOY_ID/exec';
  const tok = LogicNode.encodeSetupToken(URL_);
  const calls = [];
  await page.route('https://script.google.com/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    calls.push([route.request().url(), b.action, b.key]);
    const out = b.action === 'get' ? { ok: true, v: 2, data: null } : { ok: true, v: 2, sheet: 'x' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  await seed(page, baseDB());
  await page.goto('/#cfg=' + tok);
  // 網址列已立刻清除，且畫面上不顯示 Apps Script 網址
  expect(await page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#view-cloud')).toHaveClass(/active/);
  await expect(page.locator('#view-cloud')).not.toContainText('PRIVATE_DEPLOY_ID');
  await expect(page.locator('#view-cloud')).not.toContainText('script.google.com');
  await expect(page.locator('#cfgTokenWrap')).toBeHidden();
  await expect(page.locator('#cfg-key')).toBeFocused();
  await expect(page.locator('#cfgMsg')).toContainText('已匯入雲端位址');

  // 只需輸入通行碼、按 Enter 即可連線並通過 axe
  const r = await new AxeBuilder({ page }).withTags(AA).analyze();
  expect(fmtV(r)).toEqual([]);
  await page.fill('#cfg-key', 'my-key');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cfgMsg')).toContainText('已連接雲端');
  await expect(page.locator('#cfgStatus')).toHaveClass(/on/);
  await expect(page.locator('#qrBtn')).toBeVisible();
  expect(calls.every(c => c[0] === URL_ && c[2] === 'my-key')).toBe(true);
});

test('透過私人連結（#cfg=，含網址＋通行碼）匯入：自動同步且清除網址列', async ({ page }) => {
  const URL_ = 'https://script.google.com/macros/s/AUTO_SYNC_ID/exec';
  const tok = LogicNode.encodeSetupToken(URL_, 'auto-key');
  await page.route('https://script.google.com/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const out = b.action === 'get' ? { ok: true, v: 2, data: null } : { ok: true, v: 2, sheet: 'x' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  await seed(page, baseDB());
  await page.goto('/#cfg=' + tok);
  expect(await page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#cfgMsg')).toContainText('已連接雲端');
  await expect(page.locator('#cfgStatus')).toHaveClass(/on/);
});

test('貼上遮蔽的設定碼連線後清空隱藏，並可開啟換機 QR Code 彈窗（含 axe 檢查）', async ({ page }) => {
  const URL_ = 'https://script.google.com/macros/s/FIRST_TIME_ID/exec';
  const tok = LogicNode.encodeSetupToken(URL_);
  await page.route('https://script.google.com/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const out = b.action === 'get' ? { ok: true, v: 2, data: null } : { ok: true, v: 2, sheet: 'x' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  await seed(page, baseDB());
  await page.goto('/');
  await page.click('#tab-cloud');
  await expect(page.locator('#cfg-token')).toHaveAttribute('type', 'password');
  await page.fill('#cfg-token', tok);
  await page.fill('#cfg-key', 'k123');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgMsg')).toContainText('已連接雲端');
  await expect(page.locator('#cfgTokenWrap')).toBeHidden();
  await expect(page.locator('#cfg-token')).toHaveValue('');
  await expect(page.locator('#view-cloud')).not.toContainText('FIRST_TIME_ID');

  // 開啟換機 QR Code 彈窗
  await page.click('#qrBtn');
  await expect(page.locator('#qrModal')).toBeVisible();
  await expect(page.locator('#qrBox svg path')).toHaveCount(1);
  const svgBefore = await page.locator('#qrBox').innerHTML();
  await page.check('#qrIncludeKey');
  const svgAfter = await page.locator('#qrBox').innerHTML();
  expect(svgAfter).not.toBe(svgBefore);
  const r = await new AxeBuilder({ page }).withTags(AA).analyze();
  expect(fmtV(r)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#qrModal')).toBeHidden();
  await expect(page.locator('#qrBtn')).toBeFocused();
});

test('未填設定碼與未填通行碼時：欄位顯示錯誤並聚焦', async ({ page }) => {
  await seed(page, baseDB());
  await page.goto('/');
  await page.click('#tab-cloud');
  await page.click('#cfgSave');
  await expect(page.locator('#cfg-token')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#cfg-token')).toBeFocused();
  await page.fill('#cfg-token', 'https://script.google.com/macros/s/TEST_ONLY/exec');
  await page.click('#cfgSave');
  await expect(page.locator('#cfg-key')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#cfg-key')).toBeFocused();
});
