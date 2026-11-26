/* 理財記帳本 Service Worker：快取 App 外殼，讓它離線也能開
   策略：
   - 頁面與自家的 CSS/JS：網路優先（線上永遠拿最新、不需要手動升版），失敗才用快取
   - vendor 函式庫與圖示：快取優先（內容不常變）
   - 只有「新增/移除檔案」時才需要把 CACHE 版本號 +1，讓新檔案進預先快取清單 */
const CACHE = 'finbook-v5';
const SHELL = [
  './',
  './index.html',
  './css/style.css?v=5',
  './js/logic.js?v=5',
  './js/qrcode.js?v=5',
  './js/app.js?v=5',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/chart.umd.min.js',
  './vendor/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, fallbackKey) {
  return fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(fallbackKey || req, copy));
    }
    return res;
  }).catch(() => caches.match(fallbackKey || req, { ignoreSearch: false }).then(hit => hit || caches.match(req, { ignoreSearch: true })));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Apps Script（資料 API）一律走網路，不快取
  if (/(^|\.)google(usercontent)?\.com$/.test(url.hostname)) return;
  if (url.origin !== location.origin) return;

  // 頁面本身
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // 自家程式與樣式、manifest：網路優先
  if (/\/(css|js)\//.test(url.pathname) || /manifest\.json$/.test(url.pathname)) {
    e.respondWith(networkFirst(req));
    return;
  }

  // vendor、圖示等：快取優先
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
