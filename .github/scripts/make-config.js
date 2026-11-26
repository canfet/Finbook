#!/usr/bin/env node
/**
 * 部署時產生 config.js：後端網址從 GitHub repo 的 Repository variable（APPS_SCRIPT_URL）讀取，
 * 不放在原始碼裡。由 .github/workflows/deploy.yml 呼叫。
 */
'use strict';
const fs = require('fs');

const url = (process.env.APPS_SCRIPT_URL || '').trim();

if (!url) {
  console.error('::error title=缺少 APPS_SCRIPT_URL::請到 repo 的 Settings → Secrets and variables → Actions → Variables，新增 Repository variable：APPS_SCRIPT_URL（Apps Script 網頁應用程式網址，結尾是 /exec）');
  process.exit(1);
}
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
  console.error('::error title=APPS_SCRIPT_URL 格式不正確::應該像 https://script.google.com/macros/s/AKfy.../exec（結尾是 /exec，不要多空白或引號）');
  process.exit(1);
}

const body =
  '/* 由 GitHub Actions 在部署時自動產生，請勿手動修改（本機測試請複製 config.example.js 成 config.js） */\n' +
  'window.APP_CONFIG = ' + JSON.stringify({ API_URL: url }, null, 2) + ';\n';
fs.writeFileSync('config.js', body, 'utf8');
console.log('已產生 config.js（API_URL 已設定）');
