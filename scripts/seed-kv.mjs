#!/usr/bin/env node
/**
 * 把本地构建缓存灌进 Cloudflare KV，让线上接口立刻拥有教程与中文译文。
 *
 *   node scripts/seed-kv.mjs                 # 生成 kv-seed.json 并打印上传命令
 *   node scripts/seed-kv.mjs --upload        # 生成后直接调用 wrangler 上传（需 CLOUDFLARE_API_TOKEN）
 *
 * 灌入三类键（与运行时读取的键完全一致）：
 *   bili:v1:<仓库名>  -> 该项目的 B 站教程缓存（TTL 14 天）
 *   zh:<md5(原文)>    -> 中文译文缓存（TTL 90 天）
 *   agg:v2:<周期>     -> 聚合结果，让首个访问者直接命中缓存（TTL 30 分钟，过期自动刷新为实时数据）
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { md5 } from '../shared/md5.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')));

const NAMESPACE_ID = process.env.KV_NAMESPACE_ID
  || (() => {
    // 只在 [[kv_namespaces]] 段里找 id：wrangler.toml 里现在还有 D1 的 database_id，
    // 直接全文匹配容易拿错，这里显式限定到 KV 段。
    try {
      const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
      const kvBlock = toml.split('[[kv_namespaces]]')[1] || '';
      return kvBlock.match(/id\s*=\s*"([0-9a-f]{32})"/)?.[1];
    } catch {
      return undefined;
    }
  })();

if (!NAMESPACE_ID) {
  console.error('未找到 KV 命名空间 ID：请设置 KV_NAMESPACE_ID 或在 wrangler.toml 中填好 id。');
  process.exit(1);
}

const TTL = {
  bili: 60 * 60 * 24 * 14,
  zh: 60 * 60 * 24 * 90,
  agg: 60 * 30,
};

function readJson(file, fallback = null) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

const entries = [];
const stats = {
  bili: 0, zh: 0, agg: 0, star: 0,
};

// 1) B 站教程缓存
const biliCache = readJson(join(ROOT, 'cache', 'bili-cache.json'), {}) || {};
for (const [name, tutorials] of Object.entries(biliCache)) {
  if (!tutorials || !Array.isArray(tutorials.videos) || !tutorials.videos.length) continue;
  entries.push({
    key: `bili:v1:${name}`,
    value: JSON.stringify(tutorials),
    expiration_ttl: TTL.bili,
  });
  stats.bili += 1;
}

// 2) 中文翻译缓存
const zhCache = readJson(join(ROOT, 'cache', 'zh-cache.json'), {}) || {};
for (const [text, translated] of Object.entries(zhCache)) {
  if (!translated) continue;
  entries.push({
    key: `zh:${md5(text).slice(0, 32)}`,
    value: String(translated),
    expiration_ttl: TTL.zh,
  });
  stats.zh += 1;
}

// 3) Star 曲线历史点
const starCache = readJson(join(ROOT, 'cache', 'kv-star.json'), {}) || {};
for (const [key, value] of Object.entries(starCache)) {
  if (!key.startsWith('star:v1:')) continue;
  entries.push({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    expiration_ttl: 60 * 60 * 24 * 365,
  });
  stats.star += 1;
}

// 4) 聚合结果（让线上首个请求直接命中；过期后自动走实时抓取）
for (const period of ['week', 'month', 'year']) {
  const payload = readJson(join(ROOT, 'public', 'data', `trending-${period}.json`));
  if (!payload || !payload.sections) continue;
  entries.push({
    key: `agg:v2:${period}`,
    value: JSON.stringify(payload),
    expiration_ttl: TTL.agg,
  });
  stats.agg += 1;
}

const seedFile = join(ROOT, 'kv-seed.json');
writeFileSync(seedFile, JSON.stringify(entries, null, 0), 'utf8');
console.log(`已生成 ${seedFile}`);
console.log(`  教程键 ${stats.bili} 个 / 翻译键 ${stats.zh} 个 / 曲线键 ${stats.star} 个 / 聚合键 ${stats.agg} 个，共 ${entries.length} 条`);
console.log(`  KV 命名空间：${NAMESPACE_ID}`);

/* ---------- 上传（增量：只写缺失或变化的键，保护 KV 免费写额度） ---------- */

async function cfApi(path, init = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  if (!token || !account) throw new Error('需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`${res.status} ${JSON.stringify(json.errors || json).slice(0, 300)}`);
  }
  return json.result;
}

/** 批量读现有值（每批 100 个键） */
async function bulkGetValues(namespaceId, keys) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const result = await cfApi(`/storage/kv/namespaces/${namespaceId}/bulk/get`, {
      method: 'POST',
      body: JSON.stringify({ keys: chunk }),
    });
    if (result && result.values && typeof result.values === 'object') {
      for (const [k, v] of Object.entries(result.values)) out.set(k, v);
    }
    if (result && Array.isArray(result.keys)) {
      for (const item of result.keys) {
        if (item && item.name && item.value !== undefined) out.set(item.name, item.value);
      }
    }
  }
  return out;
}

/** 批量写入（每批 1000 条） */
async function bulkPut(namespaceId, items) {
  for (let i = 0; i < items.length; i += 1000) {
    await cfApi(`/storage/kv/namespaces/${namespaceId}/bulk`, {
      method: 'PUT',
      body: JSON.stringify(items.slice(i, i + 1000)),
    });
  }
}

if (!args.has('upload')) {
  console.log('\n上传命令（需已设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）：');
  console.log(`  node scripts/seed-kv.mjs --upload      # 增量：只写变化的键`);
  console.log(`  node scripts/seed-kv.mjs --upload --force  # 全量覆盖`);
  process.exit(0);
}

try {
  if (args.has('force')) {
    console.log(`\n全量写入 ${entries.length} 条…`);
    await bulkPut(NAMESPACE_ID, entries);
    console.log(`上传完成：写入 ${entries.length} 条。`);
  } else {
    const existing = await bulkGetValues(NAMESPACE_ID, entries.map((e) => e.key));
    const changed = entries.filter((e) => existing.get(e.key) !== e.value);
    console.log(`\nKV 现有 ${existing.size} 个键；需要更新 ${changed.length} 个，`
      + `跳过 ${entries.length - changed.length} 个内容相同的键（省写额度）。`);
    if (changed.length) {
      await bulkPut(NAMESPACE_ID, changed);
      console.log(`上传完成：写入 ${changed.length} 条。`);
    } else {
      console.log('没有需要写入的键。');
    }
  }
} catch (err) {
  console.error(`\nAPI 增量上传失败（${err.message}）`);
  console.error('可改用全量命令：');
  console.error(`  npx wrangler kv bulk put kv-seed.json --namespace-id=${NAMESPACE_ID} --remote`);
  process.exitCode = 1;
}
