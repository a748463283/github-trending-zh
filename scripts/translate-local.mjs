/**
 * 构建期翻译器（仅 Node 使用，不会打进 Workers 包）
 *
 * 提供商自动选择（也可用 TRANSLATE_PROVIDER 强制指定）：
 *   cloudflare : CF_ACCOUNT_ID + CF_AI_TOKEN / CLOUDFLARE_API_TOKEN  -> Workers AI m2m100
 *   openai     : OPENAI_API_KEY（可选 OPENAI_BASE_URL / OPENAI_MODEL）
 *   mymemory   : 免密钥公共接口（有频率限制，适合小批量/增量）
 *   glossary   : 只用术语表兜底（不联网）
 *
 * 所有译文都会写入 cache/zh-cache.json，增量累积、可提交到仓库，
 * 因此每天构建只需要翻译「新出现」的少量条目。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyGlossary, fallbackTranslate } from '../shared/glossary.js';
import { AI_MODEL, needsTranslation } from '../shared/translate.js';

export function detectProvider(env = process.env) {
  if (env.TRANSLATE_PROVIDER) return env.TRANSLATE_PROVIDER;
  if (env.CF_ACCOUNT_ID && (env.CF_AI_TOKEN || env.CLOUDFLARE_API_TOKEN)) return 'cloudflare';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'mymemory';
}

function readCache(file) {
  try {
    if (!file || !existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

async function callCloudflare(text, env) {
  const account = env.CF_ACCOUNT_ID;
  const token = env.CF_AI_TOKEN || env.CLOUDFLARE_API_TOKEN;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${AI_MODEL}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, source_lang: 'en', target_lang: 'zh' }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`cloudflare ${res.status} ${JSON.stringify(json.errors || json).slice(0, 160)}`);
  }
  return (json.result && (json.result.translated_text || json.result.response)) || '';
}

async function callOpenAI(text, env) {
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: '你是资深技术译者。把英文开源项目简介翻译成简洁、自然、专业的中文，'
            + '保留产品名与专有名词原文，只输出译文，不要引号、不要解释。',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const json = await res.json();
  return (json.choices && json.choices[0] && json.choices[0].message.content) || '';
}

export function createTranslator(options = {}) {
  const env = options.env || process.env;
  const provider = options.provider || detectProvider(env);
  const cacheFile = options.cacheFile || 'cache/zh-cache.json';
  const maxCalls = Number(options.maxCalls ?? env.TRANSLATE_MAX_CALLS ?? 150);
  const logger = options.logger || console;
  // 离线构建时完全不走网络，只用缓存 + 术语表
  const allowNetwork = options.allowNetwork !== false;
  // 连续失败（例如 429 限流）达到阈值就熔断，避免刷屏与浪费时间
  const failureLimit = Number(options.failureLimit ?? 6);

  const cache = { ...readCache(cacheFile) };
  const stats = {
    provider, calls: 0, cacheHits: 0, translated: 0, failed: 0, fallback: 0, saved: 0,
  };
  let dirty = false;
  let consecutiveFailures = 0;
  let circuitOpen = false;

  async function callProvider(text) {
    if (provider === 'cloudflare') return callCloudflare(text, env);
    if (provider === 'openai') return callOpenAI(text, env);
    if (provider === 'mymemory') return callMyMemory(text, env);
    throw new Error(`未知翻译提供商: ${provider}`);
  }

  async function translate(text) {
    const src = String(text || '').trim();
    if (!src || !needsTranslation(src)) return src;

    if (cache[src] !== undefined) {
      stats.cacheHits += 1;
      return cache[src];
    }
    if (!allowNetwork || circuitOpen || stats.calls >= maxCalls) return fallbackTranslate(src);

    let out = '';
    try {
      stats.calls += 1;
      out = String(await callProvider(src)).trim();
      consecutiveFailures = 0;
    } catch (err) {
      stats.failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures === failureLimit && !circuitOpen) {
        circuitOpen = true;
        // 用 log 而非 warn：Windows PowerShell 会把 stderr 当成命令失败
        logger.log?.(`  ! ${provider} 连续失败 ${failureLimit} 次（最后一次：${err.message}），`
          + '本次构建熔断，剩余条目仅用术语表兜底；已翻译结果仍会写入缓存。');
      }
    }
    if (!out) {
      out = fallbackTranslate(src);
      if (out) stats.fallback += 1;
    }
    if (out) {
      out = applyGlossary(out).trim();
      stats.translated += 1;
      cache[src] = out;
      dirty = true;
    }
    return out;
  }

  function save() {
    if (!dirty) return;
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, `${JSON.stringify(cache, null, 0)}\n`, 'utf8');
    stats.saved = Object.keys(cache).length;
    dirty = false;
  }

  return {
    provider, stats, translate, save, size: () => Object.keys(cache).length,
  };
}

/** 批量翻译一组仓库的描述（就地写入 descriptionZh） */
export async function translateReposLocal(repos, translator, options = {}) {
  const concurrency = options.concurrency || 4;
  const targets = repos.filter((r) => r.description && needsTranslation(r.description));
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const repo = targets[cursor];
      cursor += 1;
      repo.descriptionZh = await translator.translate(repo.description);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return targets.length;
}

async function callMyMemory(text, env) {
  const url = 'https://api.mymemory.translated.net/get'
    + `?q=${encodeURIComponent(text.slice(0, 480))}&langpair=en|zh-CN`
    + (env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(env.MYMEMORY_EMAIL)}` : '');
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const json = await res.json();
  const out = json && json.responseData && json.responseData.translatedText;
  if (!out || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error('mymemory 限额或无效响应');
  return out;
}
