#!/usr/bin/env node
/**
 * 把最新的术语表规则重新应用到已缓存的译文上（含本地缓存文件）
 *
 *   node scripts/refresh-glossary.mjs
 *
 * 场景：术语表补充了新规则（例如「克劳德 → Claude」「存储库 → 代码仓库」）后，
 * 缓存里的旧译文不会自动更新，用本脚本一次性回刷，避免重新调用翻译接口。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGlossary } from '../shared/glossary.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_FILE = join(ROOT, 'cache', 'zh-cache.json');

if (!existsSync(CACHE_FILE)) {
  console.log(`未找到 ${CACHE_FILE}，跳过。`);
  process.exit(0);
}

const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
let changed = 0;
let total = 0;

for (const [source, translated] of Object.entries(cache)) {
  if (typeof translated !== 'string' || !translated) continue;
  total += 1;
  const next = applyGlossary(translated);
  if (next !== translated) {
    cache[source] = next;
    changed += 1;
  }
}

writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 0)}\n`, 'utf8');
console.log(`术语表回刷完成：检查 ${total} 条译文，更新 ${changed} 条。`);

if (changed) {
  console.log('接下来建议执行：node scripts/build-static.mjs --offline && node scripts/seed-kv.mjs --upload');
}
