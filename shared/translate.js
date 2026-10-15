/**
 * 运行时翻译器：KV 缓存 -> Cloudflare Workers AI -> 术语表兜底
 *
 * 设计取舍：翻译失败时返回空串，前端显示英文原文并标注「原文」，
 * 不伪造译文；界面文案与分区名本身就是中文，页面始终可读。
 */

import { md5 } from './md5.js';
import { applyGlossary, fallbackTranslate } from './glossary.js';

export const AI_MODEL = '@cf/meta/m2m100-1.2b';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 90;

/** 是否需要翻译（已是中文或纯符号的文本不翻译） */
export function needsTranslation(text) {
  const src = String(text || '');
  if (src.length < 8) return false;
  const zh = (src.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (src.match(/[A-Za-z]/g) || []).length;
  if (en < 12) return false;
  return zh / (zh + en) < 0.2;
}

export function zhCacheKey(text) {
  return `zh:${md5(String(text)).slice(0, 32)}`;
}

async function kvGet(kv, key) {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

async function kvPut(kv, key, value, options) {
  if (!kv) return;
  try {
    await kv.put(key, value, options);
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

const MAX_AI_INPUT = 400;

/** 过长的描述会截断到词边界，避免模型调用失败 */
function truncateForAi(text) {
  if (text.length <= MAX_AI_INPUT) return text;
  const cut = text.slice(0, MAX_AI_INPUT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 200 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** 翻译单条文本 */
export async function translateText(text, opts = {}) {
  const { kv, ai, useAi = true } = opts;
  const src = String(text || '').trim();
  if (!src) return '';
  if (!needsTranslation(src)) return src;

  const key = zhCacheKey(src);
  const cached = await kvGet(kv, key);
  if (cached !== null) return cached;

  let out = '';
  if (useAi && ai && typeof ai.run === 'function') {
    try {
      const res = await ai.run(AI_MODEL, {
        text: truncateForAi(src), source_lang: 'en', target_lang: 'zh',
      });
      out = String((res && (res.translated_text || res.response)) || '').trim();
    } catch {
      out = '';
    }
  }
  if (!out) out = fallbackTranslate(src);
  if (!out) return '';

  out = applyGlossary(out).trim();
  await kvPut(kv, key, out, { expirationTtl: CACHE_TTL_SECONDS });
  return out;
}

/**
 * 批量翻译仓库描述
 * @returns {Promise<{translated:number, pending:number, failed:number}>}
 */
export async function translateRepos(repos, opts = {}) {
  const {
    kv, ai, budget = 60, concurrency = 4, useAi = true,
  } = opts;

  const targets = repos.filter((r) => r && r.description && needsTranslation(r.description));
  const slice = targets.slice(0, budget);
  let translated = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < slice.length) {
      const repo = slice[cursor];
      cursor += 1;
      const zh = await translateText(repo.description, { kv, ai, useAi });
      if (zh) {
        repo.descriptionZh = zh;
        translated += 1;
      } else {
        repo.descriptionZh = '';
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, slice.length) }, worker));
  return { translated, failed, pending: Math.max(0, targets.length - slice.length) };
}
