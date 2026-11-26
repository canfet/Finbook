/**
 * 理財記帳本 — Google Apps Script 後端 API
 *
 * 用法（詳見 README.md）：
 * 1. 在一份 Google Sheet 裡：擴充功能 → Apps Script，把這整個檔案貼進 Code.gs
 * 2. 上方函式選單選 setup → 執行 → 授權 → 到「執行記錄」複製 API_KEY
 * 3. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *      執行身分：我　／　誰可以存取：所有人
 *    複製 /exec 結尾的網址，跟 API_KEY 一起填到 App 的「雲端」分頁
 *
 * 資料格式：完整資料以 JSON 存在「data」分頁 A 欄（自動切塊，避開單格 5 萬字上限），
 * 另外同步寫出好讀的分頁（交易明細、未來規劃、資產、投資、預算、分類設定）方便在試算表裡看。
 */

const DATA_SHEET = 'data';
const CHUNK = 45000;     // 單格上限 50,000 字，留安全空間
const PREFIX = '~';      // 每塊加前綴，避免內容以 = + - @ 開頭被當成公式
const MAX_BODY = 5000000;      // 單次請求上限 5MB
const MAX_ITEMS = 100000;      // 每種清單的筆數上限
const MAX_FAILS = 10;          // 通行碼連續錯誤上限
const FAIL_WINDOW = 600;       // 計算錯誤次數的視窗（秒）
const PREV_SHEET = 'data_prev'; // 每次覆寫前保留上一版，方便救回

/** 第一次執行：產生通行碼並建立分頁 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('API_KEY', key);
  }
  getSheet_(DATA_SHEET);
  Logger.log('你的 API_KEY（通行碼）是：' + key);
  Logger.log('請把它填到 App「雲端」分頁。要更換通行碼，執行 resetKey。');
}

/** 想換通行碼時執行（所有裝置都要重新輸入） */
function resetKey() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  setup();
}

/** 產生私人設定碼（選用）：把你的 /exec 網址傳進來即可在執行記錄拿到 fb1. 開頭的設定碼 */
function printSetupCode_(webAppUrl, includeKey) {
  const payload = { u: String(webAppUrl || '').trim() };
  if (includeKey) payload.k = PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
  const b64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/, '');
  Logger.log('私人設定碼（請勿公開分享）：fb1.' + b64);
}

function doGet() {
  // 不洩露應用程式名稱或用途
  return json_({ ok: false });
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    if (raw.length > MAX_BODY) return json_({ ok: false, error: '資料量過大' });
    const req = JSON.parse(raw);
    if (isLocked_()) return json_({ ok: false, error: '嘗試次數過多，請 10 分鐘後再試' });
    if (!checkKey_(req.key)) { recordFail_(); return json_({ ok: false, error: '通行碼錯誤' }); }
    clearFails_();

    switch (req.action) {
      case 'ping':
        return json_({ ok: true, v: 2, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });

      case 'get':
        return json_({ ok: true, v: 2, data: readData_() });

      case 'save': {
        if (!validData_(req.data)) return json_({ ok: false, error: '資料格式錯誤' });
        const lock = LockService.getScriptLock();
        lock.waitLock(20000);
        try {
          // 樂觀並行控制：用戶端帶著「看到的雲端版本」(baseAt)，若雲端已被其他裝置更新，不覆寫，回傳最新資料讓用戶端合併後重試
          if (req.baseAt !== undefined && req.baseAt !== null) {
            const cur = readData_();
            const curAt = (cur && cur.updatedAt) || 0;
            if (cur && curAt !== req.baseAt) return json_({ ok: false, conflict: true, v: 2, data: cur });
          }
          writeData_(req.data);
          writeReadable_(req.data);
        } finally {
          lock.releaseLock();
        }
        return json_({ ok: true, v: 2, savedAt: Date.now() });
      }

      default:
        return json_({ ok: false, error: '未知的動作：' + req.action });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: '伺服器處理失敗，請稍後再試' });
  }
}

/* ---------------- 內部工具 ---------------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 固定時間比對，避免從回應時間推測通行碼
function checkKey_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real || typeof key !== 'string' || key.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= key.charCodeAt(i) ^ real.charCodeAt(i);
  return diff === 0;
}

// 通行碼連續錯誤節流（Apps Script 沒有 IP 可用，所以整體計次）
function isLocked_() {
  return Number(CacheService.getScriptCache().get('fails') || 0) >= MAX_FAILS;
}
function recordFail_() {
  const c = CacheService.getScriptCache();
  c.put('fails', String(Number(c.get('fails') || 0) + 1), FAIL_WINDOW);
}
function clearFails_() { CacheService.getScriptCache().remove('fails'); }

// 基本結構驗證：型別與筆數上限
function validData_(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.tx)) return false;
  const lists = ['tx', 'assets', 'invest', 'future'];
  for (const k of lists) {
    if (d[k] === undefined) continue;
    if (!Array.isArray(d[k]) || d[k].length > MAX_ITEMS) return false;
    if (d[k].some(x => !x || typeof x !== 'object')) return false;
  }
  if (d.budget !== undefined && (typeof d.budget !== 'object' || Array.isArray(d.budget))) return false;
  if (d.cats !== undefined && !(d.cats && Array.isArray(d.cats.income) && Array.isArray(d.cats.expense))) return false;
  return true;
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readData_() {
  const sh = getSheet_(DATA_SHEET);
  const last = sh.getLastRow();
  if (!last) return null;
  const raw = sh.getRange(1, 1, last, 1).getValues()
    .map(r => String(r[0] || ''))
    .map(s => s.charAt(0) === PREFIX ? s.slice(1) : s)  // 也相容舊版沒前綴的資料
    .join('');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function writeData_(data) {
  const str = JSON.stringify(data);
  const rows = [];
  for (let i = 0; i < str.length; i += CHUNK) rows.push([PREFIX + str.slice(i, i + CHUNK)]);
  const sh = getSheet_(DATA_SHEET);
  // 覆寫前先把目前內容留一份到 data_prev，萬一寫壞或誤覆蓋還能救回
  const last = sh.getLastRow();
  if (last) {
    const prev = getSheet_(PREV_SHEET);
    prev.clear();
    const old = sh.getRange(1, 1, last, 1).getValues();
    prev.getRange(1, 1, old.length, 1).setNumberFormat('@').setValues(old);
  }
  sh.clear();
  sh.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
}

// 避免使用者輸入的文字被試算表當成公式
function safe_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v == null ? '' : v;
}

function writeTable_(name, header, rows) {
  const sh = getSheet_(name);
  sh.clear();
  const values = [header].concat(rows.map(r => r.map(safe_)));
  sh.getRange(1, 1, values.length, header.length).setValues(values);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function writeReadable_(d) {
  const typ = t => t === 'income' ? '收入' : '支出';
  const rep = { once: '單次', monthly: '每月', quarterly: '每季', yearly: '每年' };

  writeTable_('交易明細', ['日期', '類型', '分類', '備註', '金額'],
    (d.tx || []).map(t => [t.date, typ(t.type), t.cat, t.note || '', t.amount]));

  writeTable_('未來規劃', ['項目', '分類', '類型', '金額', '重複', '起始日', '結束日'],
    (d.future || []).map(f => [f.name, f.cat || '', typ(f.type), f.amount, rep[f.rep] || f.rep, f.date, f.end || '']));

  writeTable_('資產', ['項目', '金額'],
    (d.assets || []).map(a => [a.name, a.val]));

  writeTable_('投資', ['標的', '股數', '成本價', '現價', '總成本', '市值', '損益'],
    (d.invest || []).map(v => [v.name, v.qty, v.cost, v.now, v.qty * v.cost, v.qty * v.now, v.qty * (v.now - v.cost)]));

  const bud = d.budget || {};
  writeTable_('預算', ['分類', '每月上限'], Object.keys(bud).map(k => [k, bud[k]]));

  const cats = d.cats || { income: [], expense: [] };
  const n = Math.max(cats.income.length, cats.expense.length);
  const catRows = [];
  for (let i = 0; i < n; i++) catRows.push([cats.income[i] || '', cats.expense[i] || '']);
  writeTable_('分類設定', ['收入分類', '支出分類'], catRows);
}
