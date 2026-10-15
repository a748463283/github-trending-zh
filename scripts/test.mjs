#!/usr/bin/env node
/**
 * 自测脚本
 *   node scripts/test.mjs                  # 离线单元测试 + 产物契约校验
 *   node scripts/test.mjs --integration    # 追加：真实调用 Pages Function（联网）
 *   node scripts/test.mjs --bili           # 追加：真实调用 B 站搜索（联网）
 *
 * 结果同时打印并写入 test-report.txt，便于复查。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { md5 } from '../shared/md5.js';
import { classifyRepo, CATEGORIES, ALL_CATEGORIES } from '../shared/categories.js';
import { topicZh } from '../shared/topics-zh.js';
import {
  cleanText, formatCount, parseBiliDuration, formatDuration, biliSearchUrl,
} from '../shared/text-utils.js';
import { applyGlossary, fallbackTranslate } from '../shared/glossary.js';
import { needsTranslation, zhCacheKey } from '../shared/translate.js';
import {
  buildQuery, sinceDate, periodById, normalizeRepo,
} from '../shared/github.js';
import { wbiSign, scoreTutorial } from '../shared/bilibili.js';
import { buildCurve, appendHistories, loadHistories } from '../shared/star-history.js';
import {
  parseCookies, serializeCookie, isSameOrigin, makeBiliCode,
  currentUser, publicUser, publicProfile, sanitizeFavoriteItem,
  signSession, verifySession, SESSION_TTL, MAX_FAVORITES,
} from '../shared/auth.js';
import { createKvStore, createD1Store, createUserStore } from '../shared/user-store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lines = [];
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    lines.push(`PASS  ${name}`);
  } else {
    failed += 1;
    lines.push(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const section = (title) => lines.push(`\n## ${title}`);

/* ---------- 1. MD5（WBI 签名依赖） ---------- */
section('MD5');
for (const [input, expected] of [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
]) {
  check(`md5(${JSON.stringify(input)})`, md5(input) === expected, md5(input));
}
for (const sample of ['搜索接口 wbi', 'a'.repeat(1000), '中文与 English 混排 123']) {
  check(`md5 与 node:crypto 一致（${sample.slice(0, 12)}…）`,
    md5(sample) === createHash('md5').update(sample, 'utf8').digest('hex'));
}

/* ---------- 2. 分区分类 ---------- */
section('分区分类');
const cases = [
  [{ name: 'OrcaSlicer', description: 'G-code generator for 3D printers', topics: ['3d-printing', 'slicer'], language: 'C++' }, 'printer3d'],
  [{ name: 'mcp-server-fetch', description: 'An MCP server for Claude', topics: ['mcp', 'claude'] }, 'ai-plugin'],
  [{ name: 'ollama', description: 'Get up and running with large language models locally', topics: ['llm', 'ollama'] }, 'ai'],
  [{ name: 'home-assistant-core', description: 'Open source home automation', topics: ['iot', 'home-assistant'], language: 'Python' }, 'hardware'],
  [{ name: 'awesome-rust', description: 'A curated list of Rust code and resources', topics: ['awesome', 'awesome-list'] }, 'learning'],
  [{ name: 'some-tiny-thing', description: 'hi', topics: [] }, 'other'],
  [{ name: 'mygame', description: 'An open source game engine written in C', topics: ['game-engine', 'gamedev'], language: 'C' }, 'game'],
  [{ name: 'webui', description: 'A React component library with Tailwind', topics: ['react', 'tailwindcss'], language: 'TypeScript' }, 'web'],
];
for (const [repo, expected] of cases) {
  const got = classifyRepo(repo);
  check(`分类 ${repo.name} -> ${expected}`, got === expected, got);
}
check('分区字段完整', ALL_CATEGORIES.every((c) => c.id && c.name && c.emoji && c.desc));
check('分区 id 唯一', new Set(ALL_CATEGORIES.map((c) => c.id)).size === ALL_CATEGORIES.length);
check('分区数量 >= 15', CATEGORIES.length >= 15, String(CATEGORIES.length));

/* ---------- 3. 文本工具 ---------- */
section('文本工具');
check('cleanText 去高亮标签', cleanText('你好 <em class="keyword">Ollama</em> 安装') === '你好 Ollama 安装');
check('cleanText 解码实体', cleanText('A &amp; B &lt;c&gt;') === 'A & B <c>');
check('formatCount 万', formatCount(12345) === '1.2 万', formatCount(12345));
check('formatCount 亿', formatCount(123456789) === '1.2 亿', formatCount(123456789));
check('formatCount 千', formatCount(1500) === '1.5k', formatCount(1500));
check('parseBiliDuration HH:MM:SS', parseBiliDuration('706:42') === 42402, String(parseBiliDuration('706:42')));
check('parseBiliDuration MM:SS', parseBiliDuration('13:24') === 804, String(parseBiliDuration('13:24')));
check('formatDuration', formatDuration(42402) === '11:46:42', formatDuration(42402));
check('biliSearchUrl 编码', biliSearchUrl('a b').includes('a%20b%20'), biliSearchUrl('a b'));
check('topicZh 命中', topicZh('3D-PRINTING') === '3D 打印', topicZh('3D-PRINTING'));
check('topicZh 未收录原样返回', topicZh('unknown-topic') === 'unknown-topic');

/* ---------- 4. 翻译判定与术语表 ---------- */
section('翻译');
check('needsTranslation 英文为真',
  needsTranslation('A fast, self-hosted note taking app for developers') === true);
check('needsTranslation 中文为假',
  needsTranslation('一个轻量级的自托管笔记应用，支持 Markdown') === false);
check('needsTranslation 过短为假', needsTranslation('hi') === false);
check('glossary 修正 self-hosted', applyGlossary('self-hosted 服务').includes('自托管'));
check('fallbackTranslate 全英文不硬译',
  fallbackTranslate('A blazing fast framework for arbitrary things') === '');
check('fallbackTranslate 短语可用',
  fallbackTranslate('open source, cross-platform toolkit').includes('开源')
  && fallbackTranslate('open source, cross-platform toolkit').includes('跨平台工具包'),
  fallbackTranslate('open source, cross-platform toolkit'));
check('zhCacheKey 稳定且带前缀', zhCacheKey('x') === zhCacheKey('x') && zhCacheKey('x').startsWith('zh:'));

/* ---------- 5. GitHub 查询构造 ---------- */
section('GitHub 查询');
const week = periodById('week');
check('periodById 兜底', periodById('bad').id === 'week');
check('查询含 created 与 stars 条件',
  /created:>=\d{4}-\d{2}-\d{2} stars:>=\d+/.test(buildQuery(week)), buildQuery(week));
check('sinceDate 为 7 天前',
  sinceDate(week, Date.parse('2025-06-15T00:00:00Z')) === '2025-06-08',
  sinceDate(week, Date.parse('2025-06-15T00:00:00Z')));
const normalized = normalizeRepo({
  id: 1, name: 'demo', full_name: 'me/demo', html_url: 'https://github.com/me/demo',
  owner: { login: 'me' }, description: 'A 3D printer slicer', topics: ['3d-printing'],
  stargazers_count: 10, forks_count: 2, open_issues_count: 1, language: 'C++',
  created_at: '2025-01-01T00:00:00Z', pushed_at: '2025-01-02T00:00:00Z',
});
check('normalizeRepo 生成 category', normalized.category === 'printer3d', normalized.category);
check('normalizeRepo 过滤 NOASSERTION 许可证', normalized.license === '', String(normalized.license));

/* ---------- 6. WBI 签名 ---------- */
section('WBI 签名');
const IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';
const params = { search_type: 'video', keyword: 'ollama 安装教程', page: 1 };
const signed = wbiSign(params, IMG_KEY, SUB_KEY, 1700000000000);
check('w_rid 为 32 位 hex', /^[a-f0-9]{32}$/.test(signed.w_rid), signed.w_rid);
check('参数按字典序且含 wts',
  signed.query.startsWith('keyword=') && signed.query.includes('wts=1700000000'), signed.query);
check('同一时间戳签名可复现',
  wbiSign(params, IMG_KEY, SUB_KEY, 1700000000000).w_rid === signed.w_rid);
check('不同时间戳签名不同',
  wbiSign(params, IMG_KEY, SUB_KEY, 1700000001000).w_rid !== signed.w_rid);

/* ---------- 7. 教程相关度 ---------- */
section('教程相关度');
const good = scoreTutorial({ title: 'Ollama 保姆级安装教程', duration: 800, play: 20000 }, ['ollama']);
const bad = scoreTutorial({ title: 'R 语言和 RStudio 安装教程（详细版）', duration: 1200, play: 900 }, ['ollama']);
const ad = scoreTutorial({ title: 'Ollama 安装教程 广告', duration: 800, play: 20000 }, ['ollama']);
const generic = scoreTutorial({
  title: 'Nodejs安装零基础教程2025 手把手教你入门使用', duration: 566, play: 204000,
}, ['artex', 'mhtsec']);
const sameName = scoreTutorial({ title: 'Le coucou', duration: 147, play: 90 }, ['coucou']);
const guide = scoreTutorial({ title: 'Gstack 探究', duration: 535, play: 5300 }, ['gstack']);
check('项目名 + 教程词得分 >= 6', good >= 6, String(good));
check('无关视频得分 < 6', bad < 6, String(bad));
check('广告标题被扣分', ad < good, `${ad} vs ${good}`);
check('未命中项目名的通用教程直接 0 分', generic === 0, String(generic));
check('同名但非教程内容直接 0 分', sameName === 0, String(sameName));
check('介绍类视频（探究）仍可通过', guide >= 6, String(guide));

/* ---------- 8. 前端契约 ---------- */
section('前端契约');
const appSrc = readFileSync(join(ROOT, 'src', 'app.js'), 'utf8');
const htmlSrc = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
const htmlIds = new Set([...htmlSrc.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...appSrc.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]));
const missingIds = [...usedIds].filter((id) => !htmlIds.has(id));
check('app.js 引用的 DOM id 均存在于 index.html', missingIds.length === 0, missingIds.join(', '));
check('index.html 引入了 styles.css 与 app.js',
  htmlSrc.includes('styles.css') && htmlSrc.includes('app.js'));

/* ---------- 9. 静态快照契约 ---------- */
section('静态快照');
const DATA_DIR = join(ROOT, 'public', 'data');
const snapshots = existsSync(DATA_DIR)
  ? readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')) : [];
check('至少存在一个快照文件', snapshots.length > 0, snapshots.join(', '));

const repoFieldsInApp = new Set([...appSrc.matchAll(/\brepo\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
const videoFieldsInApp = new Set([...appSrc.matchAll(/\bv\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));

for (const file of snapshots) {
  const payload = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
  const repos = payload.sections.flatMap((s) => s.repos);
  const videos = repos.flatMap((r) => (r.tutorials && r.tutorials.videos) || []);

  check(`${file} 结构合法`,
    payload.ok === true && Array.isArray(payload.sections) && payload.sections.length > 0);
  check(`${file} 分区字段完整`,
    payload.sections.every((s) => s.id && s.name && s.emoji && typeof s.count === 'number'
      && Array.isArray(s.repos) && s.repos.length > 0));

  const repoKeys = new Set(repos.flatMap((r) => Object.keys(r)));
  const missingRepo = [...repoFieldsInApp].filter((k) => !repoKeys.has(k));
  check(`${file} app.js 用到的 repo 字段齐全`, missingRepo.length === 0, missingRepo.join(', '));

  const videoKeys = new Set(videos.flatMap((v) => Object.keys(v)));
  const missingVideo = videos.length ? [...videoFieldsInApp].filter((k) => !videoKeys.has(k)) : [];
  check(`${file} 教程视频字段齐全`, missingVideo.length === 0, missingVideo.join(', '));

  check(`${file} 每个项目都有 B 站搜索入口`,
    repos.every((r) => r.tutorials && /bilibili\.com/.test(r.tutorials.searchUrl)));

  const withZh = repos.filter((r) => r.descriptionZh).length;
  const withTopicZh = repos.filter((r) => r.topics.some((t) => /[\u4e00-\u9fa5]/.test(t.zh))).length;
  check(`${file} 有中文描述或中文标签`, withZh + withTopicZh > 0,
    `译文 ${withZh} / 中文标签 ${withTopicZh}`);

  // 与原始抓取缓存对比，确保分区输出没有悄悄丢项目
  const periodId = file.replace('trending-', '').replace('.json', '');
  const rawCache = join(ROOT, 'cache', `repos-${periodId}.json`);
  if (existsSync(rawCache)) {
    const raw = JSON.parse(readFileSync(rawCache, 'utf8')).repos || [];
    check(`${file} 项目数与抓取结果一致`, repos.length === raw.length,
      `输出 ${repos.length} / 抓取 ${raw.length}`);
  }

  lines.push(`      项目 ${repos.length} 个 / 分区 ${payload.sections.length} 个`
    + ` / 译文 ${withZh} / 中文标签 ${withTopicZh} / B站教程 ${videos.length} 条`);
}

/* ---------- 10. Star 曲线与账号 ---------- */
section('Star 增长曲线');

const NOW = Date.parse('2026-10-15T00:00:00Z');

function mockKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    size: () => store.size,
  };
}

const measured = buildCurve({
  fullName: 'a/b', stars: 1000, createdAt: '2026-10-01T00:00:00Z',
  starPoints: [[1780000000, 800], [1780600000, 1000]],
}, NOW);
check('有 2 个实测点 -> measured', measured.source === 'measured', measured.source);
check('measured 算出增长量 200', measured.delta === 200, String(measured.delta));
check('measured 保留原始采样点', measured.points.length === 2 && measured.points[1][1] === 1000);

const projected = buildCurve({ stars: 3650, createdAt: '2026-09-15T00:00:00Z' }, NOW);
check('无实测点 -> projected 推算', projected.source === 'projected', projected.source);
check('projected 生成首尾两个端点',
  projected.points.length === 2 && projected.points[0][1] === 0 && projected.points[1][1] === 3650);
check('projected 日均 = 3650/30', projected.perDay === 122, String(projected.perDay));

const emptyCurve = buildCurve({ stars: 0, createdAt: '2026-10-15T00:00:00Z' }, NOW);
check('无 Star 数据时不给曲线', emptyCurve.points.length === 0);

const curveKv = mockKv();
const curveRepos = [{ fullName: 'a/b', stars: 100 }];
const firstWrite = await appendHistories(curveRepos, curveKv, NOW);
check('首次采样写入 KV', firstWrite.written === 1 && curveRepos[0].starPoints.length === 1);
const sameDay = await appendHistories(curveRepos, curveKv, NOW + 3600 * 1000);
check('同一天不重复写（保护 KV 额度）', sameDay.written === 0 && sameDay.skipped === 1);
const nextDay = await appendHistories(curveRepos, curveKv, NOW + 25 * 3600 * 1000);
check('超过 24 小时后再采样', nextDay.written === 1 && curveRepos[0].starPoints.length === 2);
check('历史可从 KV 读回', await loadHistories([{ fullName: 'a/b' }], curveKv) === 1);

const capKv = mockKv();
const capRepos = Array.from({ length: 10 }, (_, i) => ({ fullName: `a/r${i}`, stars: 100 - i }));
const capResult = await appendHistories(capRepos, capKv, NOW, { maxRepos: 3 });
check('Star 采样遵守单次上限', capResult.written === 3 && capResult.capped === 7,
  `written=${capResult.written} capped=${capResult.capped}`);
check('采样优先高 Star 项目', Boolean(capRepos[0].starPoints) && !capRepos[9].starPoints);

function failingKv() {
  return {
    async get() { return null; },
    async put() { throw new Error('KV put() limit exceeded for the day.'); },
    async delete() {},
  };
}
const quotaStore = createKvStore(failingKv());
const quotaSession = await quotaStore.createSession('42');
check('KV 写失败时 createSession 返回 null（不能假装登录成功）', quotaSession === null);
const quotaSaved = await quotaStore.upsertProfile({ githubId: '42', login: 'x' });
check('KV 写失败时 upsertProfile 返回 null（回调据此降级）', quotaSaved === null);

// 无状态签名会话：登录不再依赖 KV 写入，KV 额度用尽也能登录
const SECRET = 'unit-test-session-secret';
const signedToken = await signSession({ g: '42', l: 'alice', n: 'Alice' }, SECRET, NOW);
check('可签发签名会话', typeof signedToken === 'string' && signedToken.includes('.'));
const signedPayload = await verifySession(signedToken, SECRET, NOW);
check('签名会话可校验通过', Boolean(signedPayload) && signedPayload.g === '42');
check('换密钥后校验失败', await verifySession(signedToken, 'other-secret', NOW) === null);
check('篡改内容后校验失败',
  await verifySession(`${signedToken.slice(0, -2)}xx`, SECRET, NOW) === null);
check('过期会话校验失败',
  await verifySession(signedToken, SECRET, NOW + (SESSION_TTL + 60) * 1000) === null);
check('无密钥时不签发', await signSession({ g: '42' }, '', NOW) === null);

const signedKv = mockKv(); // 故意不写入任何用户记录，模拟 KV 写额度用尽
const signedStore = createKvStore(signedKv);
const signedRequest2 = new Request('https://s.pages.dev/api/me', {
  headers: { cookie: `gtz_session=${signedToken}` },
});
const signedUser = await currentUser(signedStore, signedRequest2, { SESSION_SECRET: SECRET });
check('签名会话即使存储无记录也能识别登录', Boolean(signedUser) && signedUser.login === 'alice');
check('签名会话标记 sessionMode', signedUser && signedUser.sessionMode === 'signed-cookie');
const noSecretUser = await currentUser(signedStore, signedRequest2, {});
check('没有密钥时签名 Cookie 不被认可', noSecretUser === null);

section('账号与 B 站关联');
const jar = parseCookies('a=1; gtz_session=deadbeef; b=x%20y');
check('Cookie 解析（含 URL 解码）', jar.gtz_session === 'deadbeef' && jar.b === 'x y');
const cookieStr = serializeCookie('gtz_session', 'tok', { maxAge: 60 });
check('会话 Cookie 带 HttpOnly / Secure / SameSite=Lax',
  /HttpOnly/.test(cookieStr) && /Secure/.test(cookieStr) && /SameSite=Lax/.test(cookieStr), cookieStr);
check('同源写操作放行',
  isSameOrigin(new Request('https://s.pages.dev/api/me', {
    method: 'POST', headers: { origin: 'https://s.pages.dev' },
  })));
check('跨站写操作拒绝',
  !isSameOrigin(new Request('https://s.pages.dev/api/me', {
    method: 'POST', headers: { origin: 'https://evil.example' },
  })));
const biliCode = makeBiliCode('tester');
check('B 站验证码格式 GTZ-XXXXXX', /^GTZ-[0-9A-F]{6}$/.test(biliCode), biliCode);

const authKv = mockKv();
const authStore = createKvStore(authKv);
await authStore.upsertProfile({ githubId: '123', login: 'tester', name: 'Tester' });
await authStore.addFavorite('123', {
  fullName: 'a/b', name: 'b', owner: 'a', url: 'https://github.com/a/b',
  stars: 1, savedAt: new Date().toISOString(),
});
await authStore.updateUser({
  ...(await authStore.getUserByGithubId('123')),
  bilibili: { mid: '999', code: biliCode, verified: false },
});
const sessionToken = await authStore.createSession('123');
const sessionRequest = new Request('https://s.pages.dev/api/me', {
  headers: { cookie: `gtz_session=${sessionToken}` },
});
const me = await currentUser(authStore, sessionRequest);
check('旧 KV 会话可解析出登录用户', Boolean(me) && me.login === 'tester', JSON.stringify(me && me.login));
const view = publicUser(me);
check('用户视图含收藏与 B 站绑定',
  view.favorites.length === 1 && view.bilibili.mid === '999' && view.bilibili.code === biliCode);
check('用户视图不泄露会话令牌', !('sessionToken' in view));
check('未绑定时 spaceUrl 为 null', publicUser({ login: 'x', bilibili: { mid: null } }).bilibili.spaceUrl === null);
await authStore.deleteSession(sessionToken);
check('退出后旧会话失效', await currentUser(authStore, sessionRequest) === null);

/* ---------- D1 用户存储（用 node:sqlite 跑真实 SQL） ---------- */
section('D1 用户存储（真实 SQL）');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  lines.push('      跳过：当前 Node 不支持 node:sqlite');
}

if (DatabaseSync) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(ROOT, 'migrations', '0001_init.sql'), 'utf8'));

  // 把 node:sqlite 包成 D1 的方法形状（prepare/bind/first/all/run）
  const d1 = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args) ?? null,
            all: async () => ({ results: stmt.all(...args), success: true }),
            run: async () => ({ success: true, meta: stmt.run(...args) }),
          };
        },
      };
    },
  };

  const store = createD1Store(d1);
  const tables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'favorites')",
  ).all();
  check('迁移脚本可执行（users / favorites 建表成功）', tables.length === 2, String(tables.length));

  const created = await store.upsertProfile({
    githubId: '7', login: 'Alice', name: 'Alice L',
    avatar: 'https://a/x.png', htmlUrl: 'https://github.com/Alice',
  });
  check('D1：登录建档成功', Boolean(created) && created.githubId === '7');
  check('D1：按 ID 读回', (await store.getUserByGithubId('7')).login === 'Alice');
  check('D1：按登录名读回（大小写不敏感）', (await store.getUserByLogin('alICE')).githubId === '7');
  check('D1：未知用户返回 null', await store.getUserByGithubId('999') === null);
  check('D1：未知登录名返回 null', await store.getUserByLogin('nobody') === null);

  const item = sanitizeFavoriteItem({
    fullName: 'o/r', name: 'r', owner: 'o', stars: 42, descriptionZh: '中文描述',
    topics: [{ key: 'react', zh: 'React' }],
  });
  const afterAdd = await store.addFavorite('7', item);
  check('D1：收藏写入并返回列表', afterAdd.length === 1 && afterAdd[0].fullName === 'o/r');
  check('D1：快照字段完整（topics JSON 往返正常）',
    afterAdd[0].stars === 42 && afterAdd[0].topics[0].zh === 'React'
    && afterAdd[0].savedAt === item.savedAt);
  check('D1：收藏计数正确', await store.countFavorites('7') === 1);
  const newer = new Date(Date.now() + 1000).toISOString();
  const afterSecond = await store.addFavorite('7', { ...item, fullName: 'o/r2', savedAt: newer });
  check('D1：多收藏按收藏时间倒序', afterSecond[0].fullName === 'o/r2');
  // 同一时刻收藏两个（时间戳完全相同）时用 rowid 兜底，顺序仍然确定
  const tie = await store.addFavorite('7', { ...item, fullName: 'o/r3', savedAt: newer });
  check('D1：时间戳相同时后插入的排在前面', tie[0].fullName === 'o/r3', tie[0].fullName);
  check('D1：时间戳相同时另一条紧随其后', tie[1].fullName === 'o/r2', tie[1].fullName);
  await store.removeFavorite('7', 'o/r3');
  const afterRemove = await store.removeFavorite('7', 'o/r');
  check('D1：收藏删除生效', afterRemove.length === 1 && afterRemove[0].fullName === 'o/r2');
  const reAdd = await store.addFavorite('7', item);
  check('D1：同一仓库重复收藏不产生重复行', reAdd.length === 2 && await store.countFavorites('7') === 2);

  await store.updateUser({
    ...(await store.getUserByGithubId('7')),
    publicProfile: false,
    bilibili: {
      mid: '123', code: 'GTZ-ABCDEF', verified: true, label: 'UP主', sign: '签名',
      reason: null, linkedAt: '2026-01-01T00:00:00Z', checkedAt: '2026-01-02T00:00:00Z',
    },
  });
  const reLogin = await store.upsertProfile({
    githubId: '7', login: 'Alice2', name: 'Alice Renamed', avatar: '', htmlUrl: '',
  });
  check('D1：重新登录保留收藏（ON CONFLICT 关键回归点）',
    reLogin.favorites.length === 2, JSON.stringify(reLogin.favorites));
  check('D1：重新登录保留 B 站绑定',
    Boolean(reLogin.bilibili) && reLogin.bilibili.mid === '123' && reLogin.bilibili.verified === true);
  check('D1：重新登录保留公开设置', reLogin.publicProfile === false);
  check('D1：重新登录更新资料', reLogin.login === 'Alice2' && reLogin.name === 'Alice Renamed');
  check('D1：改名后旧名查不到', await store.getUserByLogin('Alice') === null);
  check('D1：改名后新名可查', (await store.getUserByLogin('alice2')).githubId === '7');

  await store.upsertProfile({ githubId: '8', login: 'Bob' });
  check('D1：不同用户的收藏互相隔离', await store.countFavorites('8') === 0);
  check('D1：用户表行数正确', sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n === 2);
  check('D1：公开视图仍不含验证码', publicProfile(reLogin).bilibili.code === undefined);
}

section('个人主页与收藏快照');


const goodItem = sanitizeFavoriteItem({
  fullName: 'owner/repo', name: 'repo', owner: 'owner', url: 'https://github.com/owner/repo',
  avatar: 'https://avatars.githubusercontent.com/u/1?v=4', stars: 1234.9, language: 'Rust',
  description: 'A tool', descriptionZh: '一个工具', topics: [{ key: 'a', zh: '甲' }],
});
check('合法收藏快照通过校验', Boolean(goodItem) && goodItem.fullName === 'owner/repo' && goodItem.stars === 1234);
check('快照带上收藏时间', Boolean(goodItem.savedAt));
check('非 https 头像被丢弃',
  sanitizeFavoriteItem({ fullName: 'a/b', avatar: 'javascript:alert(1)' }).avatar === '');
check('非法仓库名被拒绝', sanitizeFavoriteItem({ fullName: '../etc/passwd' }) === null);
check('非法 url 回退到 GitHub 地址',
  sanitizeFavoriteItem({ fullName: 'a/b', url: 'https://evil.example/x' }).url === 'https://github.com/a/b');
check('topics 最多保留 5 个',
  sanitizeFavoriteItem({
    fullName: 'a/b',
    topics: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, zh: `v${i}` })),
  }).topics.length === 5);
check('超长描述被截断',
  sanitizeFavoriteItem({ fullName: 'a/b', description: 'x'.repeat(999) }).description.length === 300);
check('空输入返回 null', sanitizeFavoriteItem(null) === null);

const profileView = publicProfile({
  githubId: '123', login: 'tester', name: 'Tester', avatar: '', htmlUrl: 'https://github.com/tester',
  createdAt: '2026-10-15T00:00:00Z', favorites: ['a/b'],
  favoriteItems: [{ fullName: 'a/b', name: 'b', owner: 'a', stars: 5, savedAt: '2026-10-15T00:00:00Z' }],
  bilibili: { mid: '999', code: 'GTZ-AAAAAA', verified: true, label: '测试UP' },
});
check('公开视图不含 B 站验证码', profileView.bilibili.code === undefined);
check('公开视图不含 GitHub ID / 会话', profileView.githubId === undefined && profileView.sessionToken === undefined);
check('公开视图含收藏数量与列表',
  profileView.favoritesCount === 1 && profileView.favorites.length === 1);
check('未绑定 B 站时公开视图为 null', publicProfile({ login: 'x' }).bilibili === null);

const indexKv = mockKv();
const indexStore = createKvStore(indexKv);
await indexStore.upsertProfile({ githubId: '42', login: 'Alice', name: 'Alice' });
const foundByName = await indexStore.getUserByLogin('alice');
check('KV：按登录名可查用户（大小写不敏感）', Boolean(foundByName) && foundByName.githubId === '42');
check('KV：未知登录名返回 null', await indexStore.getUserByLogin('nobody') === null);
check('createUserStore 未绑定任何存储时返回 null', createUserStore({}) === null);
check('createUserStore 优先选 D1', createUserStore({
  USER_DB: { prepare() {} }, TRENDING_KV: { get() {} },
}).kind === 'd1');

const meHtmlPath = join(ROOT, 'src', 'me', 'index.html');
const meJsPath = join(ROOT, 'src', 'me', 'me.js');
check('个人主页源文件存在', existsSync(meHtmlPath) && existsSync(meJsPath));
const meHtmlSrc = readFileSync(meHtmlPath, 'utf8');
const meJsSrc = readFileSync(meJsPath, 'utf8');
const meIds = new Set([...meHtmlSrc.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const meUsed = new Set([...meJsSrc.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]));
const meMissing = [...meUsed].filter((id) => !meIds.has(id));
check('me.js 引用的 DOM id 都在 me/index.html 中', meMissing.length === 0, meMissing.join(', '));
check('个人主页已产出到 public/me/', existsSync(join(ROOT, 'public', 'me', 'index.html')));

/* ---------- 11. 可选：联网集成测试 ---------- */
const flags = new Set(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2)),
);

if (flags.has('integration')) {
  section('Pages Function 集成测试（联网）');
  const mod = await import('../functions/api/trending.js');
  const env = {
    FETCH_LIMIT: '30', BILI_FILL_BUDGET: '0', TRANSLATE_BUDGET: '3', CACHE_TTL: '60',
  };
  const res = await mod.onRequestGet({
    request: new Request('https://example.com/api/trending?period=week'),
    env,
  });
  const json = await res.json();
  check('返回 200 且为 JSON',
    res.status === 200 && String(res.headers.get('content-type')).includes('application/json'));
  check('ok=true', json.ok === true, json.error || '');
  if (json.ok) {
    check('返回分区数据', json.sections.length > 0, String(json.sections.length));
    check('meta 记录 KV/AI 绑定状态',
      json.meta && typeof json.meta.kvBound === 'boolean' && typeof json.meta.aiBound === 'boolean');
    check('项目字段与快照结构一致',
      ['name', 'url', 'stars', 'topics', 'tutorials'].every((k) => k in json.sections[0].repos[0]));
    lines.push(`      接口返回 ${json.sections.length} 个分区 / ${json.sections.reduce((n, s) => n + s.repos.length, 0)} 个项目`);
  }
}

if (flags.has('bili')) {
  section('B 站检索集成测试（联网）');
  const { searchVideos, findTutorials } = await import('../shared/bilibili.js');
  const raw = await searchVideos('ollama 安装教程', { pageSize: 5 });
  check('匿名可检索 B 站', !raw.error && raw.videos.length > 0, raw.error || '0 条');
  if (raw.videos.length) {
    check('标题已清洗高亮标签', !/<em/.test(raw.videos[0].title), raw.videos[0].title);
  }
  const tut = await findTutorials({ name: 'ollama', owner: 'ollama' }, { limit: 3 });
  check('教程过滤后仍有结果', tut.videos.length > 0, `${tut.videos.length} 条 / ${tut.error || 'ok'}`);
  lines.push(`      示例：${tut.videos.map((v) => `${v.title}（${v.author}）`).join(' | ') || '无'}`);
}

/* ---------- 输出报告 ---------- */
const report = `GitHub 热门中文榜 自测报告
生成时间：${new Date().toISOString()}
结果：${failed === 0 ? '全部通过' : '存在失败项'}（通过 ${passed} / 失败 ${failed}）
${lines.join('\n')}
`;
writeFileSync(join(ROOT, 'test-report.txt'), report, 'utf8');
console.log(report);
process.exitCode = failed === 0 ? 0 : 1;


