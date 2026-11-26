/* 理財記帳本：純邏輯（不碰 DOM），瀏覽器以 window.Logic 使用，Node 以 require 載入並由 tests/logic.test.js 測試 */
(function (root) {
  "use strict";
  const pad2 = n => String(n).padStart(2, "0");
  const ymdLocal = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const KINDS = ["tx", "assets", "invest", "future"];
  const MAX_AMOUNT = 1e11; // 1,000 億

  /* ---------- 金額 ---------- */
  // 四捨五入到小數 dp 位，避免 0.1+0.2 這類浮點誤差
  function round2(n, dp = 2) {
    const k = Math.pow(10, dp);
    return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * k) / k;
  }
  // 解析使用者輸入的金額；空白、非數字、超過上限都回傳 NaN
  function parseMoney(v, dp = 2) {
    if (v === "" || v == null) return NaN;
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n) || Math.abs(n) > MAX_AMOUNT) return NaN;
    return round2(n, dp);
  }

  /* ---------- id ---------- */
  function uid() {
    const c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- 月份 / 規劃 ---------- */
  function monthKeys(n, now = new Date()) {
    const a = [];
    for (let i = n - 1; i >= 0; i--) a.push(ymdLocal(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7));
    return a;
  }
  function futureMonths(n, now = new Date()) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(ymdLocal(new Date(now.getFullYear(), now.getMonth() + i, 1)).slice(0, 7));
    return a;
  }
  // 判斷某項目在指定月份(YYYY-MM)是否發生
  function hitsMonth(item, mKey) {
    const s = String(item.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(s)) return false;
    if (item.rep === "once") return s === mKey;
    if (mKey < s) return false;
    if (item.end && mKey > item.end.slice(0, 7)) return false;
    const [sy, sm] = s.split("-").map(Number), [my, mm] = mKey.split("-").map(Number);
    const diff = (my - sy) * 12 + (mm - sm);
    if (item.rep === "monthly") return true;
    if (item.rep === "quarterly") return diff % 3 === 0;
    if (item.rep === "yearly") return diff % 12 === 0;
    return false;
  }
  // 以起始日的「日」為準加月份，處理月底（如 31 號遇到 2 月）
  function addMonthsKeepDay(base, addM, day) {
    const target = new Date(base.getFullYear(), base.getMonth() + addM, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    target.setHours(0, 0, 0, 0);
    return target;
  }
  // 「今天(含)之後」的下一次發生日期；已結束或無則回 null
  function nextDueDate(item, now = new Date()) {
    const start = new Date(item.date + "T00:00:00");
    if (isNaN(start)) return null;
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const end = item.end ? new Date(item.end + "T00:00:00") : null;
    const step = item.rep === "monthly" ? 1 : item.rep === "quarterly" ? 3 : item.rep === "yearly" ? 12 : 0;
    if (!step) return (start >= today && (!end || start <= end)) ? start : null;
    let d = new Date(start), guard = 0;
    const day = start.getDate();
    while (d < today && guard < 2400) d = addMonthsKeepDay(start, step * (++guard), day);
    if (end && d > end) return null;
    return d;
  }

  /* ---------- 同步：依 id 合併，不再整份覆蓋 ---------- */
  function sigDB(d) {
    d = d || {};
    const items = KINDS.map(k => (d[k] || []).map(x => x.id + ":" + (x.u || 0)).sort().join(","));
    const sortObj = o => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, o[k]]));
    return [items.join("|"), sortObj(d.budget), JSON.stringify(d.cats || null), Object.keys(d.del || {}).sort().join(",")].join("#");
  }
  const TOMB_TTL = 180 * 86400000;
  // 合併兩份資料：項目取聯集、同 id 取較新(u)者；刪除以「墓碑」記錄，晚於最後編輯的刪除會生效。預算與分類取較新的一份。
  function mergeDB(a, b, now = Date.now()) {
    a = a || {}; b = b || {};
    const newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
    const older = newer === a ? b : a;
    const del = {};
    [older.del, newer.del].forEach(m => { for (const k in (m || {})) if (!(k in del) || m[k] > del[k]) del[k] = m[k]; });
    for (const k in del) if (now - del[k] > TOMB_TTL) delete del[k];
    const out = { ...older, ...newer };
    KINDS.forEach(kind => {
      const map = new Map();
      [older[kind] || [], newer[kind] || []].forEach(list => list.forEach(x => {
        if (x == null || x.id == null) return;
        const cur = map.get(String(x.id));
        // 同 id：u 較大者勝；相同則以 newer（後處理）為準
        if (!cur || (x.u || 0) >= (cur.u || 0)) map.set(String(x.id), x);
      }));
      out[kind] = [...map.values()].filter(x => !(del[kind + ":" + x.id] >= (x.u || 0)));
    });
    out.tx.sort((p, q) => String(q.date).localeCompare(String(p.date)));
    out.del = del;
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
    return out;
  }
  // 刪除一個項目並留下墓碑
  function removeItem(db, kind, id, now = Date.now()) {
    db[kind] = (db[kind] || []).filter(x => x.id != id);
    db.del = db.del || {};
    db.del[kind + ":" + id] = now;
  }
  // 還原備份時，為「目前有、備份沒有」的項目補墓碑，避免被其他裝置的舊資料合併回來
  function restoreTombstones(current, backup, now = Date.now()) {
    const del = { ...(backup.del || {}) };
    KINDS.forEach(k => (current[k] || []).forEach(x => {
      if (!(backup[k] || []).some(y => y.id == x.id)) del[k + ":" + x.id] = now;
    }));
    backup.del = del;
    return backup;
  }

  /* ---------- 匯入資料清理 ---------- */
  function sanitizeDB(d, today) {
    const isObj = x => x && typeof x === "object" && !Array.isArray(x);
    const str = (v, max = 200) => String(v == null ? "" : v).slice(0, max);
    const num = v => { const n = parseFloat(v); return isFinite(n) && Math.abs(n) <= MAX_AMOUNT ? n : 0; };
    const out = { ...d };
    out.tx = (Array.isArray(d.tx) ? d.tx : []).filter(isObj).map(t => ({
      ...t, id: t.id ?? uid(), type: t.type === "income" ? "income" : "expense", amount: num(t.amount),
      cat: str(t.cat), note: str(t.note, 500), date: DATE_RE.test(t.date) ? t.date : today
    }));
    out.assets = (Array.isArray(d.assets) ? d.assets : []).filter(isObj).map(a => ({ ...a, id: a.id ?? uid(), name: str(a.name), val: num(a.val) }));
    out.invest = (Array.isArray(d.invest) ? d.invest : []).filter(isObj).map(v => ({ ...v, id: v.id ?? uid(), name: str(v.name), qty: num(v.qty), cost: num(v.cost), now: num(v.now) }));
    out.future = (Array.isArray(d.future) ? d.future : []).filter(isObj).map(f => ({
      ...f, id: f.id ?? uid(), type: f.type === "income" ? "income" : "expense", name: str(f.name), amount: num(f.amount), cat: str(f.cat),
      rep: ["once", "monthly", "quarterly", "yearly"].includes(f.rep) ? f.rep : "once",
      date: DATE_RE.test(f.date) ? f.date : today, end: DATE_RE.test(f.end) ? f.end : ""
    }));
    const bud = {};
    if (isObj(d.budget)) for (const k in d.budget) { const n = num(d.budget[k]); if (n > 0) bud[str(k)] = n; }
    out.budget = bud;
    out.del = isObj(d.del) ? d.del : {};
    return out;
  }

  const api = { round2, parseMoney, uid, monthKeys, futureMonths, hitsMonth, addMonthsKeepDay, nextDueDate, sigDB, mergeDB, removeItem, restoreTombstones, sanitizeDB, ymdLocal, KINDS, MAX_AMOUNT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== "undefined" ? window : globalThis);
