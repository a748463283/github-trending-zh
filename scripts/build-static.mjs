#!/usr/bin/env node
/**
 * 构建静态站点与数据快照
 *
 *   node scripts/build-static.mjs               # 联网：抓 GitHub + 翻译 + 补教程，生成 public/
 *   node scripts/build-static.mjs --offline     # 离线：只用 cache/ 里的数据重建页面与快照
 *   node scripts/build-static.mjs --periods=week
 *   node scripts/build-static.mjs --bili-budget=30 --translate-max=200
 *
 * 产物：
 *   public/index.html app.js styles.css  前端站点
 *   public/data/trending-<周期>.json     静态快照（API 不可用时前端自动回退）
 *   cache/repos-<周期>.json              GitHub 原始数据缓存（离线构建用）
 *   cache/bili-cache.json                哔哩哔哩教程缓存（增量累积）
 *   cache/zh-cache.json                  中文翻译缓存（增量累积）
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERIODS, fetchTrending } from '../shared/github.js';
import { buildPayload } from '../shared/payload.js';
import { attachTutorials } from '../shared/bilibili.js';
import { loadHistories, appendHistories } from '../shared/star-history.js';
import { createTranslator, translateReposLocal } from './translate-local.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'src');
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(PUBLIC_DIR, 'data');
const CACHE_DIR = join(ROOT, 'cache');

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? 'true' : v];
}));

const OFFLINE = args.get('offline') === 'true';
const PERIOD_IDS = (args.get('periods') || 'week,month,year').split(',').map((s) => s.trim());
const BILI_BUDGET = Number(args.get('bili-budget') || process.env.BILI_BUDGET || 30);
const TRANSLATE_MAX = Number(args.get('translate-max') || process.env.TRANSLATE_MAX_CALLS || 150);

const log = (...a) => console.log(...a);

function readJson(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    log(`  ! 读取 ${file} 失败：${err.message}`);
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 用本地文件模拟 KV，以便复用与线上完全相同的 Star 曲线读写逻辑 */
function createFileKv(file) {
  const store = readJson(file, {}) || {};
  let dirty = false;
  return {
    async get(key) {
      return store[key] === undefined ? null : store[key];
    },
    async put(key, value) {
      store[key] = value;
      dirty = true;
    },
    async delete(key) {
      delete store[key];
      dirty = true;
    },
    save() {
      if (dirty) {
        writeJson(file, store);
        dirty = false;
      }
    },
    size: () => Object.keys(store).length,
  };
}

/** 1) 复制前端静态文件 */
function copyStaticAssets() {
  const files = ['index.html', 'app.js', 'styles.css'];
  for (const f of files) {
    const from = join(SRC_DIR, f);
    if (!existsSync(from)) throw new Error(`缺少前端文件 src/${f}`);
    writeFileSync(join(PUBLIC_DIR, f), readFileSync(from));
  }

  // 个人主页 / 收藏页（/me/）
  const meDir = join(PUBLIC_DIR, 'me');
  mkdirSync(meDir, { recursive: true });
  for (const f of ['index.html', 'me.js']) {
    const from = join(SRC_DIR, 'me', f);
    if (!existsSync(from)) throw new Error(`缺少前端文件 src/me/${f}`);
    writeFileSync(join(meDir, f), readFileSync(from));
  }
  log('· 个人主页已复制到 public/me/（index.html, me.js）');

  writeFileSync(join(PUBLIC_DIR, '_headers'), [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: SAMEORIGIN',
    '/data/*',
    '  Cache-Control: public, max-age=600',
    '/api/*',
    '  Cache-Control: public, max-age=300',
    '',
  ].join('\n'), 'utf8');

  writeFileSync(join(PUBLIC_DIR, 'robots.txt'), [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
  ].join('\n'), 'utf8');

  log(`· 前端文件已复制到 public/（${files.join(', ')}）`);
}

/** 2) 构建单个周期的数据 */
async function buildPeriod(periodId, translator, biliCache, starKv) {
  const period = PERIODS.find((p) => p.id === periodId);
  if (!period) throw new Error(`未知周期：${periodId}`);

  const now = Date.now();
  const reposFile = join(CACHE_DIR, `repos-${period.id}.json`);
  let repos;
  let meta;

  if (OFFLINE) {
    const cached = readJson(reposFile);
    if (!cached || !Array.isArray(cached.repos)) {
      log(`  ! 离线模式缺少 ${reposFile}，跳过「${period.name}」`);
      return null;
    }
    repos = cached.repos;
    meta = { ...(cached.meta || {}), offline: true };
    log(`· ${period.name}：使用本地缓存 ${repos.length} 个项目`);
  } else {
    const result = await fetchTrending(period, {
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    });
    repos = result.repos;
    meta = result.meta;
    writeJson(reposFile, {
      generatedAt: new Date().toISOString(), period: period.id, meta, repos,
    });
    log(`· ${period.name}：GitHub 返回 ${repos.length} 个项目（共 ${result.meta.totalCount} 个匹配）`);
  }

  // 复用哔哩哔哩教程缓存
  let biliHits = 0;
  for (const repo of repos) {
    const hit = biliCache[repo.name];
    if (hit && Array.isArray(hit.videos) && hit.videos.length) {
      repo.tutorials = hit;
      biliHits += 1;
    }
  }

  // 增量补抓教程
  const fill = { used: 0, errors: 0 };
  if (BILI_BUDGET > 0 && !OFFLINE) {
    const res = await attachTutorials(repos, {
      budget: BILI_BUDGET,
      delayMs: 320,
      cookie: process.env.BILI_COOKIE || undefined,
    });
    fill.used = res.used;
    fill.errors = res.errors;
    log(`  · B 站教程：缓存命中 ${biliHits}，新抓取 ${fill.used}（失败 ${fill.errors}）`);
  } else {
    log(`  · 跳过教程抓取（缓存命中 ${biliHits}）`);
  }

  for (const repo of repos) {
    const t = repo.tutorials;
    if (t && Array.isArray(t.videos) && t.videos.length) biliCache[repo.name] = t;
  }

  // 中文翻译
  const translateTargets = await translateReposLocal(repos, translator);

  // Star 增长曲线：读取历史点并追加本次采样（与线上同一套逻辑，文件模拟 KV 无额度限制，故不设上限）
  const historyHits = await loadHistories(repos, starKv);
  const historyWrite = await appendHistories(repos, starKv, now, { maxRepos: repos.length });

  const payload = buildPayload({
    period,
    repos,
    periods: PERIODS,
    now,
    meta: {
      ...meta,
      translation: {
        targets: translateTargets,
        translated: repos.filter((r) => r.descriptionZh).length,
        provider: translator.provider,
      },
      tutorials: { kvHits: biliHits, filled: fill.used, errors: fill.errors },
      starHistory: {
        loaded: historyHits, written: historyWrite.written, skipped: historyWrite.skipped,
      },
      snapshot: true,
    },
    extra: { source: OFFLINE ? 'static-snapshot:cache' : 'static-snapshot:build' },
  });

  writeJson(join(DATA_DIR, `trending-${period.id}.json`), payload);

  const withTutorials = repos.filter(
    (r) => r.tutorials && Array.isArray(r.tutorials.videos) && r.tutorials.videos.length,
  ).length;
  const translated = repos.filter((r) => r.descriptionZh).length;
  log(`  · 输出：${payload.sections.length} 个分区 / ${repos.length} 个项目`
    + ` / 已翻译 ${translated} / 有教程 ${withTutorials}`);

  return {
    sectionCount: payload.sections.length, repoCount: repos.length, translated, withTutorials,
  };
}

async function main() {
  const started = Date.now();
  log(`\n=== 构建 GitHub 热门中文榜（${OFFLINE ? '离线模式' : '联网模式'}） ===`);

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  copyStaticAssets();

  const translator = createTranslator({
    provider: args.get('translate-provider') === 'true' ? undefined : args.get('translate-provider'),
    cacheFile: join(CACHE_DIR, 'zh-cache.json'),
    maxCalls: TRANSLATE_MAX,
    allowNetwork: !OFFLINE,
  });
  log(`· 翻译提供商：${translator.provider}（缓存 ${translator.size()} 条，本次上限 ${TRANSLATE_MAX} 次调用）`);

  const biliCacheFile = join(CACHE_DIR, 'bili-cache.json');
  const biliCache = readJson(biliCacheFile, {}) || {};

  const starKv = createFileKv(join(CACHE_DIR, 'kv-star.json'));
  log(`· Star 曲线历史：${starKv.size()} 个仓库已有采样点`);

  const summary = [];
  for (const id of PERIOD_IDS) {
    try {
      const result = await buildPeriod(id, translator, biliCache, starKv);
      if (result) summary.push({ id, ...result });
    } catch (err) {
      log(`  ! 「${id}」构建失败：${err.message}`);
      summary.push({ id, error: err.message });
    }
  }

  translator.save();
  writeJson(biliCacheFile, biliCache);
  starKv.save();

  log('\n=== 构建结果 ===');
  for (const s of summary) {
    log(s.error
      ? `  x ${s.id}：${s.error}`
      : `  v ${s.id}：${s.repoCount} 个项目 / ${s.sectionCount} 个分区 / 有教程 ${s.withTutorials} 条`);
  }
  log(`  翻译缓存：${translator.size()} 条，本次新增 ${translator.stats.translated} 条`
    + `（缓存命中 ${translator.stats.cacheHits}，失败 ${translator.stats.failed}）`);
  log(`  教程缓存：${Object.keys(biliCache).length} 个项目，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (!summary.some((s) => !s.error)) {
    log('\n所有周期都失败了，请检查网络或 GH_TOKEN。');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('构建失败：', err);
  process.exitCode = 1;
});

