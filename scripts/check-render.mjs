#!/usr/bin/env node
/**
 * 浏览器端渲染验收：启动静态预览 -> 用系统里的 Edge/Chrome 无头渲染 -> 断言页面内容
 *
 *   node scripts/check-render.mjs                 # 默认检查周榜
 *   node scripts/check-render.mjs --period=month
 *   set BROWSER_PATH=C:\path\to\chrome.exe && node scripts/check-render.mjs
 *
 * 找不到浏览器时会明确提示并跳过（退出码 0），不会误判为失败。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CHECK_RENDER_PORT || 8793);
const periodArg = process.argv.slice(2).find((a) => a.startsWith('--period='));
const PERIOD = periodArg ? periodArg.split('=')[1] : 'week';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.log('未找到 Edge/Chrome，跳过浏览器渲染验收。');
  console.log('可通过环境变量 BROWSER_PATH 指定浏览器可执行文件路径。');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForExit(child) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function waitForServer(url, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  return false;
}

const server = spawn(process.execPath, ['scripts/serve.mjs', `--port=${PORT}`], {
  cwd: ROOT, stdio: 'ignore',
});

let html = '';
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
  if (!ok) failed += 1;
};

try {
  const ready = await waitForServer(`http://127.0.0.1:${PORT}/data/trending-${PERIOD}.json`);
  check('静态服务器就绪', ready);
  if (!ready) throw new Error('预览服务器未能在 10 秒内就绪');

  const profile = join(tmpdir(), `gtz-render-${Date.now()}`);
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=12000', '--dump-dom',
    `http://127.0.0.1:${PORT}/?period=${PERIOD}`,
  ];
  const run = await waitForExit(spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] }));
  html = run.out;

  const count = (re) => (html.match(re) || []).length;
  const text = (re) => {
    const m = html.match(re);
    return m ? m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
  };

  check('渲染出 HTML', html.length > 2000, `${html.length} 字节`);
  check('已渲染分区', count(/<section class="section"/g) >= 5, String(count(/<section class="section"/g)));
  check('已渲染卡片', count(/<article class="card"/g) >= 5, String(count(/<article class="card"/g)));
  check('分区导航已生成', count(/data-cat="/g) >= 5, String(count(/data-cat="/g)));
  check('中文标签已渲染', count(/<li class="tag">/g) >= 5, String(count(/<li class="tag">/g)));
  check('Star 增长曲线已渲染', count(/class="spark/g) >= 5, String(count(/class="spark/g)));
  check('曲线有文字说明', count(/class="trend-label"/g) >= 5, String(count(/class="trend-label"/g)));
  check('卡片都有收藏按钮', count(/class="fav-btn"/g) >= count(/<article class="card"/g),
    `${count(/class="fav-btn"/g)} 个按钮 / ${count(/<article class="card"/g)} 张卡片`);
  check('账号区已渲染（登录按钮或待配置提示）',
    /class="auth-login/.test(html) || /id="auth-toggle"/.test(html));
  check('每张卡片都有 B 站入口',
    count(/search\.bilibili\.com/g) >= count(/<article class="card"/g),
    `${count(/search\.bilibili\.com/g)} 个链接 / ${count(/<article class="card"/g)} 张卡片`);
  check('统计行有中文与数量', /共 <strong>\d+<\/strong> 个项目/.test(html), text(/<p class="stat-line"[^>]*>([\s\S]*?)<\/p>/));
  check('未卡在加载状态', !/正在加载数据/.test(html));
  check('未出现数据不可用', !/数据暂时不可用/.test(html));
  check('无未转义的脚本注入', !/<script>alert/.test(html));

  console.log(`\n统计行：${text(/<p class="stat-line"[^>]*>([\s\S]*?)<\/p>/)}`);
  console.log(`B 站视频直链：${count(/bilibili\.com\/video\//g)} 条`);

  // 个人主页 / 收藏页（静态预览下应表现为「未登录」空态且不报错）
  const meArgs = args.map((a) => (a.startsWith('http') ? `http://127.0.0.1:${PORT}/me/?period=${PERIOD}` : a));
  const meRun = await waitForExit(spawn(browser, meArgs, { stdio: ['ignore', 'pipe', 'pipe'] }));
  const meHtml = meRun.out;
  check('个人主页可渲染', meHtml.length > 1500, `${meHtml.length} 字节`);
  check('个人主页显示登录入口或未登录提示',
    /还没有登录|用 GitHub 登录|GitHub 登录（待配置）/.test(meHtml));
  check('个人主页未报脚本错误', !/数据暂时不可用/.test(meHtml));
} catch (err) {
  check('渲染验收执行', false, err.message);
} finally {
  server.kill();
}

console.log(`\n渲染验收结果：${failed === 0 ? '通过' : `失败 ${failed} 项`}`);
process.exitCode = failed === 0 ? 0 : 1;
