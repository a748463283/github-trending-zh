/**
 * GitHub 热门仓库抓取与归一化（Workers / Node 通用）
 *
 * 数据来源：GitHub 官方 Search API（无需第三方服务）
 *   查询 = created:>=周期起始日 stars:>=阈值，按 Star 降序
 * 含义：该周期内「新创建且最有热度」的项目，这是可稳定复现的“热门”口径。
 *
 * 环境变量：
 *   GH_TOKEN  可选，配置后接口限额由 10 次/分 提升到 30 次/分
 */

import { classifyRepo } from './categories.js';
import { cleanText } from './text-utils.js';

export const PERIODS = [
  { id: 'week', name: '本周', days: 7, minStars: 20, note: '近 7 天内新建的仓库' },
  { id: 'month', name: '本月', days: 30, minStars: 100, note: '近 30 天内新建的仓库' },
  { id: 'year', name: '今年', days: 365, minStars: 1000, note: '近 365 天内新建的仓库' },
];

export function periodById(id) {
  return PERIODS.find((p) => p.id === id) || PERIODS[0];
}

export function sinceDate(period, now = Date.now()) {
  return new Date(now - period.days * 86400000).toISOString().slice(0, 10);
}

export function buildQuery(period, now = Date.now()) {
  return `created:>=${sinceDate(period, now)} stars:>=${period.minStars}`;
}

/** 把 GitHub API 原始条目转成站点统一结构 */
export function normalizeRepo(item) {
  const topics = Array.isArray(item.topics) ? item.topics.slice(0, 8) : [];
  const repo = {
    id: item.id,
    name: item.name,
    owner: item.owner ? item.owner.login : '',
    fullName: item.full_name,
    url: item.html_url,
    homepage: item.homepage || '',
    description: cleanText(item.description || ''),
    descriptionZh: '',
    language: item.language || '',
    license: item.license && item.license.spdx_id && item.license.spdx_id !== 'NOASSERTION'
      ? item.license.spdx_id
      : '',
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    openIssues: item.open_issues_count || 0,
    topics,
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
    archived: Boolean(item.archived),
    avatar: item.owner ? item.owner.avatar_url : '',
  };
  repo.category = classifyRepo(repo);
  return repo;
}

function authHeaders(token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'github-trending-zh/1.0',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/**
 * 抓取一个周期的热门仓库
 * @param {object} period PERIODS 中的一项
 * @param {{token?:string, limit?:number, fetchImpl?:typeof fetch, now?:number}} opts
 * @returns {Promise<{repos:Array, meta:object}>}
 */
export async function fetchTrending(period, opts = {}) {
  const { token, limit = 100, fetchImpl = fetch, now = Date.now() } = opts;
  const perPage = Math.min(Math.max(1, limit), 100);
  const q = buildQuery(period, now);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}`
    + `&sort=stars&order=desc&per_page=${perPage}`;

  const res = await fetchImpl(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    err.rateLimit = res.headers.get('x-ratelimit-remaining');
    throw err;
  }

  const json = await res.json();
  const repos = (json.items || []).map(normalizeRepo);
  return {
    repos,
    meta: {
      period: period.id,
      query: q,
      totalCount: json.total_count || 0,
      fetched: repos.length,
      rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
      generatedAt: new Date(now).toISOString(),
    },
  };
}

/** 按分区聚合，分区内部按 Star 降序，空分区不输出 */
export function groupByCategory(repos) {
  const map = new Map();
  for (const repo of repos) {
    if (!map.has(repo.category)) map.set(repo.category, []);
    map.get(repo.category).push(repo);
  }
  for (const list of map.values()) list.sort((a, b) => b.stars - a.stars);
  return map;
}
