// 財務邏輯單元測試：npm test（Node 內建 test runner，不需瀏覽器）
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const D = (y, m, d) => new Date(y, m - 1, d);
const ymd = d => d && L.ymdLocal(d);

test.describe('金額', () => {
  test('round2 消除浮點誤差', () => {
    assert.equal(L.round2(0.1 + 0.2), 0.3);
    assert.equal(L.round2(1.005), 1.01);
    assert.equal(L.round2(-0.1 - 0.2), -0.3);
    assert.equal(L.round2(0), 0);
  });
  test('parseMoney：空白、非數字、超過上限回傳 NaN', () => {
    assert.ok(Number.isNaN(L.parseMoney('')));
    assert.ok(Number.isNaN(L.parseMoney('abc')));
    assert.ok(Number.isNaN(L.parseMoney(null)));
    assert.ok(Number.isNaN(L.parseMoney('1e12')));
    assert.ok(Number.isNaN(L.parseMoney(Infinity)));
    assert.equal(L.parseMoney('123.456'), 123.46);
    assert.equal(L.parseMoney('45.3456', 4), 45.3456);
    assert.equal(L.parseMoney('-50000'), -50000);
  });
  test('uid 不重複', () => {
    const s = new Set(Array.from({ length: 5000 }, () => L.uid()));
    assert.equal(s.size, 5000);
  });
});

test.describe('hitsMonth（規劃項目是否落在某月）', () => {
  test('單次', () => {
    const f = { rep: 'once', date: '2026-03-15' };
    assert.ok(L.hitsMonth(f, '2026-03'));
    assert.ok(!L.hitsMonth(f, '2026-04'));
  });
  test('每月：起始月之前不算，結束月之後不算', () => {
    const f = { rep: 'monthly', date: '2026-03-31', end: '2026-06-01' };
    assert.ok(!L.hitsMonth(f, '2026-02'));
    assert.ok(L.hitsMonth(f, '2026-03'));
    assert.ok(L.hitsMonth(f, '2026-06'));
    assert.ok(!L.hitsMonth(f, '2026-07'));
  });
  test('每季：每 3 個月，跨年也正確', () => {
    const f = { rep: 'quarterly', date: '2025-11-10' };
    assert.deepEqual(['2025-11', '2026-02', '2026-05', '2026-08', '2026-11'].map(m => L.hitsMonth(f, m)), [true, true, true, true, true]);
    assert.ok(!L.hitsMonth(f, '2026-01'));
    assert.ok(!L.hitsMonth(f, '2026-03'));
  });
  test('每年', () => {
    const f = { rep: 'yearly', date: '2024-02-29' };
    assert.ok(L.hitsMonth(f, '2025-02'));
    assert.ok(L.hitsMonth(f, '2028-02'));
    assert.ok(!L.hitsMonth(f, '2025-03'));
  });
  test('日期壞掉時不丟例外、回傳 false', () => {
    assert.equal(L.hitsMonth({ rep: 'monthly', date: '' }, '2026-01'), false);
    assert.equal(L.hitsMonth({ rep: 'monthly' }, '2026-01'), false);
  });
});

test.describe('nextDueDate / 月底處理', () => {
  test('每月 31 號：遇到 2 月落在月底，之後回到 31', () => {
    const f = { rep: 'monthly', date: '2026-01-31' };
    assert.equal(ymd(L.nextDueDate(f, D(2026, 2, 1))), '2026-02-28');
    assert.equal(ymd(L.nextDueDate(f, D(2028, 2, 1))), '2028-02-29'); // 閏年
    assert.equal(ymd(L.nextDueDate(f, D(2026, 3, 1))), '2026-03-31');
    assert.equal(ymd(L.nextDueDate(f, D(2026, 4, 1))), '2026-04-30');
  });
  test('今天剛好是到期日算「今天」', () => {
    const f = { rep: 'monthly', date: '2026-01-15' };
    assert.equal(ymd(L.nextDueDate(f, D(2026, 5, 15))), '2026-05-15');
    assert.equal(ymd(L.nextDueDate(f, D(2026, 5, 16))), '2026-06-15');
  });
  test('每季、每年', () => {
    assert.equal(ymd(L.nextDueDate({ rep: 'quarterly', date: '2026-01-10' }, D(2026, 2, 1))), '2026-04-10');
    assert.equal(ymd(L.nextDueDate({ rep: 'yearly', date: '2025-06-01' }, D(2026, 6, 2))), '2027-06-01');
  });
  test('已結束與單次已過期回傳 null', () => {
    assert.equal(L.nextDueDate({ rep: 'monthly', date: '2026-01-01', end: '2026-03-01' }, D(2026, 6, 1)), null);
    assert.equal(L.nextDueDate({ rep: 'once', date: '2026-01-01' }, D(2026, 6, 1)), null);
    assert.equal(ymd(L.nextDueDate({ rep: 'once', date: '2026-09-01' }, D(2026, 6, 1))), '2026-09-01');
  });
  test('日期壞掉回傳 null', () => {
    assert.equal(L.nextDueDate({ rep: 'monthly', date: 'bad' }), null);
  });
});

test.describe('monthKeys / futureMonths', () => {
  test('跨年', () => {
    assert.deepEqual(L.monthKeys(3, D(2026, 1, 20)), ['2025-11', '2025-12', '2026-01']);
    assert.deepEqual(L.futureMonths(3, D(2025, 11, 30)), ['2025-11', '2025-12', '2026-01']);
  });
  test('31 號不會讓月份跳掉', () => {
    assert.deepEqual(L.futureMonths(3, D(2026, 1, 31)), ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(L.monthKeys(3, D(2026, 3, 31)), ['2026-01', '2026-02', '2026-03']);
  });
});

test.describe('mergeDB（多裝置同步）', () => {
  const tx = (id, u, extra = {}) => ({ id, u, type: 'expense', amount: 10, cat: '飲食', note: '', date: '2026-05-01', ...extra });
  const base = (o) => ({ tx: [], assets: [], invest: [], future: [], budget: {}, cats: { income: ['薪資'], expense: ['飲食'] }, del: {}, updatedAt: 1, ...o });

  test('兩邊各自新增：聯集，不遺失', () => {
    const a = base({ tx: [tx('a', 10)], updatedAt: 10 });
    const b = base({ tx: [tx('b', 20)], updatedAt: 20 });
    const m = L.mergeDB(a, b, 100);
    assert.deepEqual(m.tx.map(x => x.id).sort(), ['a', 'b']);
    assert.equal(m.updatedAt, 20);
  });
  test('同 id：較新的編輯勝出（與合併順序無關）', () => {
    const a = base({ tx: [tx('x', 10, { amount: 1 })], updatedAt: 10 });
    const b = base({ tx: [tx('x', 50, { amount: 99 })], updatedAt: 5 });
    assert.equal(L.mergeDB(a, b, 100).tx[0].amount, 99);
    assert.equal(L.mergeDB(b, a, 100).tx[0].amount, 99);
  });
  test('刪除（墓碑）會生效，不會被另一台的舊資料救回', () => {
    const a = base({ tx: [], del: { 'tx:x': 30 }, updatedAt: 30 });
    const b = base({ tx: [tx('x', 10)], updatedAt: 10 });
    assert.equal(L.mergeDB(a, b, 100).tx.length, 0);
    assert.equal(L.mergeDB(b, a, 100).tx.length, 0);
  });
  test('刪除之後又編輯（u 較新）→ 項目保留', () => {
    const a = base({ del: { 'tx:x': 30 }, updatedAt: 30 });
    const b = base({ tx: [tx('x', 40)], updatedAt: 40 });
    assert.equal(L.mergeDB(a, b, 100).tx.length, 1);
  });
  test('預算與分類取較新的一份', () => {
    const a = base({ budget: { 飲食: 100 }, updatedAt: 10 });
    const b = base({ budget: { 飲食: 200 }, updatedAt: 20 });
    assert.equal(L.mergeDB(a, b, 100).budget['飲食'], 200);
  });
  test('合併是冪等的（再合併一次不變），sigDB 相同', () => {
    const a = base({ tx: [tx('a', 10)], updatedAt: 10 });
    const b = base({ tx: [tx('b', 20)], del: { 'tx:z': 5 }, updatedAt: 20 });
    const m1 = L.mergeDB(a, b, 100), m2 = L.mergeDB(m1, b, 100), m3 = L.mergeDB(b, m1, 100);
    assert.equal(L.sigDB(m1), L.sigDB(m2));
    assert.equal(L.sigDB(m1), L.sigDB(m3));
  });
  test('過期墓碑會被清除', () => {
    const old = Date.now() - 400 * 86400000;
    const m = L.mergeDB(base({ del: { 'tx:old': old } }), base(), Date.now());
    assert.ok(!('tx:old' in m.del));
  });
  test('缺 id 或 null 的項目不會造成例外', () => {
    const m = L.mergeDB(base({ tx: [null, { amount: 1 }, tx('ok', 1)] }), base(), 100);
    assert.equal(m.tx.length, 1);
  });
  test('舊資料（沒有 u、沒有 del）也能合併', () => {
    const a = { tx: [{ id: 1, amount: 5, date: '2026-01-01' }], updatedAt: 1 };
    const b = { tx: [{ id: 2, amount: 6, date: '2026-01-02' }], updatedAt: 2 };
    assert.equal(L.mergeDB(a, b, 100).tx.length, 2);
  });
});

test.describe('removeItem / restoreTombstones', () => {
  test('removeItem 刪除並留墓碑；字串與數字 id 都能刪', () => {
    const db = { tx: [{ id: 7 }, { id: 8 }] };
    L.removeItem(db, 'tx', '7', 123);
    assert.deepEqual(db.tx, [{ id: 8 }]);
    assert.equal(db.del['tx:7'], 123);
  });
  test('還原備份：目前有、備份沒有的項目補墓碑，備份內的不補', () => {
    const cur = { tx: [{ id: 'keep' }, { id: 'gone' }], assets: [{ id: 'a1' }] };
    const bak = { tx: [{ id: 'keep' }], assets: [] };
    L.restoreTombstones(cur, bak, 500);
    assert.deepEqual(Object.keys(bak.del).sort(), ['assets:a1', 'tx:gone']);
  });
  test('還原後再與舊裝置合併，不會把被取代的資料救回來', () => {
    const cur = { tx: [{ id: 'old', u: 1, date: '2026-01-01' }], updatedAt: 1 };
    const bak = L.restoreTombstones(cur, { tx: [{ id: 'new', u: 5, date: '2026-01-02' }], updatedAt: 10 }, 10);
    const merged = L.mergeDB(bak, cur, 20);
    assert.deepEqual(merged.tx.map(x => x.id), ['new']);
  });
});

test.describe('sanitizeDB（匯入／雲端資料清理）', () => {
  test('壞日期改成指定日、壞型別被修正、金額上限', () => {
    const d = L.sanitizeDB({
      tx: [{ id: 1, type: 'weird', amount: '12.5', date: '', cat: 'x', note: 'n' }, 'junk', null],
      assets: [{ id: 2, name: 'a', val: 1e15 }],
      invest: 'notarray', budget: { a: 100, b: -5, c: 'x' }, future: [{ id: 3, rep: 'hack', date: '2026-01-01', amount: 1 }],
    }, '2026-07-01');
    assert.equal(d.tx.length, 1);
    assert.equal(d.tx[0].date, '2026-07-01');
    assert.equal(d.tx[0].type, 'expense');
    assert.equal(d.tx[0].amount, 12.5);
    assert.equal(d.assets[0].val, 0);
    assert.deepEqual(d.invest, []);
    assert.deepEqual(d.budget, { a: 100 });
    assert.equal(d.future[0].rep, 'once');
  });
  test('過長字串被截斷、缺 id 補上', () => {
    const d = L.sanitizeDB({ tx: [{ amount: 1, date: '2026-01-01', note: 'x'.repeat(2000) }] }, '2026-01-01');
    assert.equal(d.tx[0].note.length, 500);
    assert.ok(d.tx[0].id);
  });
});
