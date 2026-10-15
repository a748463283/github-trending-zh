#!/usr/bin/env node
/**
 * 部署前自检（建议在 git push 之前跑）
 *
 *   node scripts/preflight.mjs
 *
 * 做四件事：
 *   1. 扫描工作区里是否混入了密钥/令牌（Cloudflare、GitHub、OpenAI、私钥）
 *   2. 检查 .gitignore 是否覆盖了机密文件
 *   3. 检查 wrangler.toml 有没有把机密写死
 *   4. 若已是 git 仓库，检查 .dev.vars 等机密文件有没有被 git 跟踪/暂存
 *
 * 有任何一项失败会以退出码 1 结束，可以挂在 CI 的第一道关卡上。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.wrangler', '.github', 'dist', 'build',
]);
const SKIP_FILES = new Set([
  '.dev.vars', '.env', 'preflight-report.txt',
]);
// 允许出现的示例/占位内容
const ALLOW_SUBSTRINGS = [
  'cfat_xxxxxxxx',
  'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'sk-xxxxxxxx',
  '请替换',
  '在这里填',
];

const SECRET_PATTERNS = [
  { name: 'Cloudflare API Token', re: /cfat_[A-Za-z0-9_-]{20,}/g },
  { name: 'Cloudflare Global API Key', re: /\b[a-f0-9]{37}\b/g },
  { name: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{30,}/g },
  { name: 'OpenAI 风格密钥', re: /\bsk-[A-Za-z0-9]{30,}/g },
  { name: '私钥内容', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
  if (!ok) failed += 1;
}

function info(text) {
  results.push(`      ${text}`);
}

/* ---------- 1. 扫描密钥 ---------- */
const findings = [];
let scannedFiles = 0;
const MAX_SCAN_BYTES = 512 * 1024;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      if (entry.name === '.dev.vars' || entry.name === '.env') continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const ext = extname(entry.name).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip'].includes(ext)) continue;

    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_SCAN_BYTES) continue;

    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    scannedFiles += 1;
    const rel = relative(ROOT, full);
    const lines = text.split(/\r?\n/);
    for (const pattern of SECRET_PATTERNS) {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (ALLOW_SUBSTRINGS.some((s) => line.includes(s))) continue;
        pattern.re.lastIndex = 0;
        if (pattern.re.test(line)) {
          findings.push(`${rel}:${i + 1} 疑似 ${pattern.name}`);
        }
      }
    }
  }
}

walk(ROOT);
check(`工作区未发现明文密钥（扫描 ${scannedFiles} 个文本文件）`, findings.length === 0,
  findings.slice(0, 8).join(' ; '));
for (const f of findings.slice(0, 8)) info(f);

/* ---------- 2. .gitignore 覆盖 ---------- */
const gitignorePath = join(ROOT, '.gitignore');
const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
const gitignoreEntries = gitignore
  .split(/\r?\n/)
  .map((l) => l.trim().replace(/\/+$/, ''))
  .filter((l) => l && !l.startsWith('#'));
for (const need of ['.dev.vars', '.env', 'node_modules', 'kv-seed.json']) {
  check(`.gitignore 覆盖 ${need}`, gitignoreEntries.includes(need));
}

/* ---------- 3. wrangler.toml 不含机密 ---------- */
const wranglerPath = join(ROOT, 'wrangler.toml');
if (existsSync(wranglerPath)) {
  const toml = readFileSync(wranglerPath, 'utf8');
  const suspicious = toml.split(/\r?\n/).filter((line) => {
    if (/^\s*#/.test(line)) return false;
    return /(^|\s)(token|secret|password|api_key)\s*=\s*["'][^"']+["']/i.test(line);
  });
  check('wrangler.toml 未写死机密（只应包含 id 等标识符）', suspicious.length === 0,
    suspicious.join(' ; '));
  check('wrangler.toml 已绑定 KV 与 D1',
    /\[\[kv_namespaces\]\]/.test(toml) && /\[\[d1_databases\]\]/.test(toml));
}

/* ---------- 4. git 跟踪情况 ---------- */
let isRepo = false;
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'pipe' });
  isRepo = true;
} catch {
  isRepo = false;
}

if (!isRepo) {
  check('git 仓库状态', true, '尚未初始化（首次推送前执行 git init 即可）');
} else {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  const dangerous = tracked.filter((f) => /(^|\/)\.(dev\.vars|env)$/.test(f)
    || f.endsWith('kv-seed.json'));
  check('机密文件未被 git 跟踪', dangerous.length === 0, dangerous.join(', '));
  info(`已跟踪文件 ${tracked.length} 个`);

  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  info(`当前分支 ${branch}${dirty ? '（有未提交改动）' : '（工作区干净）'}`);
}

/* ---------- 输出 ---------- */
const report = `部署前自检报告
生成时间：${new Date().toISOString()}
结果：${failed === 0 ? '全部通过' : `存在 ${failed} 项失败`}
${results.join('\n')}
`;
console.log(report);
process.exitCode = failed === 0 ? 0 : 1;
