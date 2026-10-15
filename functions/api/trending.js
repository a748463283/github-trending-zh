/**
 * Cloudflare Pages Function: GET /api/trending?period=week|month|year
 *
 * 流程：
 *   KV 聚合缓存 -> GitHub Search API -> B 站教程（KV 缓存 + 小批量补抓）
 *   -> 中文翻译（KV 缓存 + Workers AI）-> 按分区聚合并返回
 *
 * 上游异常时返回 { ok:false, error }，前端会自动回退到构建期静态快照，
 * 保证页面不白屏。
 */

import { PERIODS, periodById, fetchTrending } from '../../shared/github.js';
import { translateRepos } from '../../shared/translate.js';
import { attachTutorials } from '../../shared/bilibili.js';
import { buildPayload } from '../../shared/payload.js';
import { loadHistories, appendHistories } from '../../shared/star-history.js';

const AGG_PREFIX = 'agg:v2:';
const TUTORIAL_PREFIX = 'bili:v1:';
const TUTORIAL_TTL = 60 * 60 * 24 * 14;

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    },
  });
}

async function kvGetJson(kv, key) {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function kvPutJson(kv, key, value, options) {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(value), options);
  } catch {
    /* 缓存写失败不影响响应 */
  }
}

/** 并发受限地读取每个仓库的教程缓存 */
async function loadTutorials(repos, kv) {
  if (!kv) return 0;
  let hit = 0;
  let cursor = 0;
  const CONCURRENCY = 12;

  async function worker() {
    while (cursor < repos.length) {
      const repo = repos[cursor];
      cursor += 1;
      const cached = await kvGetJson(kv, `${TUTORIAL_PREFIX}${repo.name}`);
      if (cached) {
        repo.tutorials = cached;
        hit += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return hit;
}

async function saveTutorials(repos, kv) {
  if (!kv) return;
  await Promise.all(repos.map((repo) => (repo.tutorials
    ? kvPutJson(kv, `${TUTORIAL_PREFIX}${repo.name}`, repo.tutorials, { expirationTtl: TUTORIAL_TTL })
    : Promise.resolve())));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const period = periodById(url.searchParams.get('period') || 'week');
  const skipCache = url.searchParams.get('nocache') === '1';
  const kv = env.TRENDING_KV || null;
  const cookie = env.BILI_COOKIE || undefined;
  const now = Date.now();
  const aggKey = `${AGG_PREFIX}${period.id}`;

  // 1) 聚合缓存
  if (!skipCache) {
    const cached = await kvGetJson(kv, aggKey);
    if (cached && cached.ok) {
      return jsonResponse({ ...cached, meta: { ...cached.meta, cached: true } }, 200, {
        'cache-control': 'public, max-age=300, s-maxage=900',
      });
    }
  }

  // 2) GitHub 热门数据
  let repos;
  let meta;
  try {
    const result = await fetchTrending(period, {
      token: env.GH_TOKEN,
      limit: Number(env.FETCH_LIMIT || 100),
      now,
    });
    repos = result.repos;
    meta = result.meta;
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: `GitHub 数据抓取失败：${err.message}`,
      period: period.id,
      generatedAt: new Date(now).toISOString(),
    }, 200, { 'cache-control': 'no-store' });
  }

  // 3) Star 增长曲线：读历史点 + 追加本次数据点
  //    采样有上限（默认 40 个/周期）且每仓库每天最多一次，
  //    目的是把 KV 写入量控制在免费额度（1000 次写/天）之内，给登录/收藏留余量。
  const historyHits = await loadHistories(repos, kv);
  const historyWrite = await appendHistories(repos, kv, now, {
    maxRepos: Number(env.STAR_SAMPLE_LIMIT || 40),
  });

  // 4) B 站教程：先读缓存，再用小额预算增量补抓（控制请求频率，避免风控）
  const tutorialHits = await loadTutorials(repos, kv);
  const fillBudget = skipCache ? 0 : Number(env.BILI_FILL_BUDGET ?? 6);
  let fill = { used: 0, errors: 0 };
  if (fillBudget > 0 && repos.length) {
    const candidates = repos.slice(0, Math.min(repos.length, fillBudget * 4));
    fill = await attachTutorials(candidates, { budget: fillBudget, cookie, delayMs: 250, now });
    if (fill.used > 0) await saveTutorials(candidates, kv);
  }

  // 5) 中文翻译
  const tr = await translateRepos(repos, {
    kv,
    ai: env.AI,
    budget: Number(env.TRANSLATE_BUDGET ?? 60),
    useAi: env.DISABLE_AI_TRANSLATE !== 'true',
  });

  // 6) 组装输出
  const payload = buildPayload({
    period,
    repos,
    periods: PERIODS,
    now,
    meta: {
      ...meta,
      translation: tr,
      tutorials: { kvHits: tutorialHits, filled: fill.used, errors: fill.errors },
      starHistory: {
        loaded: historyHits,
        written: historyWrite.written,
        skipped: historyWrite.skipped,
        capped: historyWrite.capped,
      },
      kvBound: Boolean(kv),
      aiBound: Boolean(env.AI),
    },
    extra: { source: 'github-search-api' },
  });

  await kvPutJson(kv, aggKey, payload, { expirationTtl: Number(env.CACHE_TTL || 1800) });
  return jsonResponse(payload, 200, { 'cache-control': 'public, max-age=300, s-maxage=900' });
}

// 只导出 onRequestGet：其它 HTTP 方法由 Pages 自动返回 405
