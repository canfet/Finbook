# 理財記帳本（PWA + Google Apps Script）

前端放 **GitHub Pages**，資料透過 **Google Apps Script** 存進你自己的 **Google Sheet**。
在 iPhone / Android 上「加到主畫面」後，用起來就像一個 App（全螢幕、有圖示、離線也能記帳）。

```
手機 App（GitHub Pages 上的 index.html）
   │  每筆先存在手機（離線可用）
   │  連網後 POST JSON ↓
Apps Script 網頁應用程式（Code.gs）── 讀寫 ──▶ 你的 Google Sheet
```

## 檔案說明

| 檔案 | 放哪裡 | 用途 |
|---|---|---|
| `index.html` | GitHub | App 本體 |
| `manifest.json` | GitHub | 讓手機能「安裝」成 App |
| `sw.js` | GitHub | 離線快取 |
| `icons/` | GitHub | App 圖示 |
| `apps-script/Code.gs` | **Apps Script**（不用上傳也沒關係） | 後端 API |

> repo 裡**沒有任何密碼**，通行碼只存在你的手機裡，所以 repo 設成公開也安全。

---

## 步驟一：設定 Apps Script 後端（約 5 分鐘）

1. 開一份新的 Google 試算表（或沿用舊的那份）。
2. 上方選單 **擴充功能 → Apps Script**。
3. 把 `Code.gs` 預設內容全部刪掉，貼上本專案的 `apps-script/Code.gs`，按 💾 儲存。
   - 若以前有 `index.html` 檔案在 Apps Script 裡，可以刪掉了，前端改由 GitHub 提供。
4. 上方函式下拉選 **`setup`** → 按 **執行** → 依指示授權（會出現「Google 尚未驗證這個應用程式」→ 進階 → 前往（不安全）→ 允許，因為是你自己寫的腳本）。
5. 下方「執行記錄」會顯示 **API_KEY（通行碼）**，複製起來。
6. 右上 **部署 → 新增部署作業** → 齒輪選 **網頁應用程式**：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
7. 按部署，複製 **網頁應用程式網址**（`https://script.google.com/macros/s/…/exec`）。

> 為什麼要選「所有人」？因為 App 是從 github.io 呼叫的，帶不上你的 Google 登入。
> 資料是靠 **通行碼** 保護的：沒有通行碼的人打這個網址只會拿到「通行碼錯誤」。

## 步驟二：上傳到 GitHub 並開啟 Pages

**網頁操作（不用裝任何東西）：**

1. 到 github.com → 右上 **＋ → New repository**，名稱例如 `finbook`，按 Create。
2. 點 **uploading an existing file**，把 `index.html`、`manifest.json`、`sw.js`、`icons` 資料夾（以及 README、apps-script 可選）拖進去 → **Commit changes**。
3. repo 的 **Settings → Pages** → Source 選 **Deploy from a branch** → Branch 選 **main**、資料夾 **/ (root)** → Save。
4. 等 1–2 分鐘，網址會是：`https://你的帳號.github.io/finbook/`

**或用指令：**

```bash
cd finance-app
git init && git add . && git commit -m "理財記帳本"
git branch -M main
git remote add origin https://github.com/你的帳號/finbook.git
git push -u origin main
```

## 步驟三：連接雲端（私人設定，網站不含後端網址）

這個公開網站本身**不包含任何 Apps Script 網址或密碼**，別人打開網站只會是空白的本機記帳本。

1. **第一台裝置（例如電腦）**：
   - 打開 `https://你的帳號.github.io/finbook/`，切到 **☁️ 雲端** 分頁。
   - 在 **私人設定碼或連結**（以星號遮蔽、不會明文顯示）貼上步驟一的 `/exec` 網址，輸入 **通行碼** → 按 **連接並同步**。
   - 連線成功後，輸入欄會自動清空並隱藏，畫面上只留通行碼。
2. **匯入到手機（私人 QR Code／一次性設定連結）**：
   - 在已連線的電腦「雲端」分頁按 **產生換機 QR Code／私人連結**。
   - 預設**只帶入雲端位址**（不含通行碼，較安全）；若想掃完直接連線可勾選「一併帶入通行碼」。
   - 用手機掃描 QR Code 或點開私人連結，開啟後會自動匯入設定並**立刻清除網址列**。

## 步驟四：裝到手機

- **iPhone / iPad**：先用 **Safari** 開網站 → 下方「分享」⬆ → **加入主畫面**。從主畫面打開 App 後（iOS 主畫面 App 與 Safari 儲存空間分開），按電腦端彈窗裡的 **「複製設定碼」** 貼到「私人設定碼或連結」欄再輸入通行碼。
- **Android**：用 **Chrome** 掃描「換機 QR Code」匯入後 → 右上「⋮」→ **安裝應用程式**（或「加到主畫面」）。

之後每台裝置都會同步同一份 Google Sheet。

---

## 之後要更新

- **改了前端**（index.html 等）：上傳到 GitHub 後，把 `sw.js` 第一行的 `finbook-v1` 改成 `finbook-v2`（每次 +1），手機才會換成新版。重開 App 一兩次就會更新。
- **改了 Code.gs**：部署 → **管理部署作業** → ✏️ 編輯 → 版本選 **新版本** → 部署。這樣網址不變，手機不用重設。
  （若按「新增部署作業」會產生新網址，就得到每台手機重新填。）
- **想換通行碼**：在 Apps Script 執行 `resetKey`，再到每台裝置重新輸入。

## 同步規則

- 每次變動先存手機，0.8 秒後上傳雲端；離線時會顯示紅點，連網後自動補傳。
- 打開 App 或從背景切回來時會向雲端拉資料，**較新的那份勝出**。
- 同一段時間在兩台裝置都離線記帳，連線後會以較晚修改的那台為準 —— 建議定期用「雲端 → 下載備份檔」留一份。

## 常見問題

| 狀況 | 解法 |
|---|---|
| 連線失敗：回應格式錯誤 | 網址要是 `/exec` 結尾（不是 `/dev`），存取權要設「所有人」 |
| 通行碼錯誤 | 重新到 Apps Script 執行 `setup` 看記錄裡的 API_KEY |
| 改了 Code.gs 沒反應 | 要「管理部署作業 → 新版本」，只儲存不會生效 |
| 手機一直是舊版畫面 | `sw.js` 的版本號要改，然後完全關掉 App 再開 |

## 想上架 App Store / Google Play？

PWA 不用上架就能用。若之後真的想上架，可以把這個網址丟進 [PWABuilder](https://www.pwabuilder.com/) 產生 Android（TWA）與 iOS 套件，或用 Capacitor 包成原生 App；iOS 上架需要 Apple 開發者帳號（年費 USD 99）。

## 專案結構與開發

- `index.html`（結構）、`css/style.css`（樣式，含深色模式）、`js/app.js`（介面邏輯）、`js/logic.js`（純邏輯：金額、規劃日期、多裝置合併，可在 Node 測試）
- `vendor/`：Chart.js 與 SheetJS 自家託管；xlsx 體積大，按「匯出 Excel」才載入
- 頁面已啟用 Content-Security-Policy（只允許自家腳本與 Google Apps Script 連線）
- Service Worker：頁面與自家 CSS/JS 網路優先（線上永遠最新），vendor／圖示快取優先；只有「新增或移除檔案」時才需要升 `sw.js` 的 `CACHE` 版本並更新 `SHELL` 清單
- 同步：依項目 id 合併（刪除以墓碑記錄），不會再整份覆蓋；Apps Script 每次覆寫前會把上一版留在 `data_prev` 分頁
- Apps Script 後端有通行碼錯誤節流（10 分鐘內錯誤 10 次即鎖定）與大小／結構驗證，更新 `Code.gs` 後要重新部署新版本

### 測試

```bash
npm install
npx playwright install chromium
npm test            # 財務邏輯單元測試（日期、月底、合併、清理）
npm run test:a11y   # 瀏覽器：axe WCAG 2.2 AA（淺／深色、手機）、CSP、400% 縮放、強制色彩、同步合併等
npm run test:all
```

GitHub Actions（`.github/workflows/test.yml`）會在 push／PR 時自動執行以上測試。

## 部署到 GitHub Pages（不需要設定任何 Variable 或 Secret）

1. 推送到 `main`。
2. **Settings → Pages**，Source 選 **GitHub Actions**。
3. 推送後 `.github/workflows/deploy.yml` 會：跑單元測試（失敗就不部署）→ 移除測試與後端檔案 → 發佈。
4. 公開網站裡完全不含你的 Apps Script 網址與通行碼；在自己裝置上透過「私人 QR Code / 設定連結 / 設定碼」匯入即可。
