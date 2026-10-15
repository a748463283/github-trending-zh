/**
 * 输出结构组装（Pages Function 与静态快照构建脚本共用）
 * 保证「实时接口」和「构建期快照」返回完全一致的数据结构。
 */

import { CATEGORIES, OTHER_CATEGORY } from './categories.js';
import { topicZh } from './topics-zh.js';
import { biliSearchUrl, formatCount, relativeDays } from './text-utils.js';
import { buildCurve } from './star-history.js';

// 单分区输出上限：仅作为载荷体积保护，设为抓取上限即可保证不丢项目
export const MAX_PER_CATEGORY = 100;

export function tutorialView(repo) {
  const t = repo.tutorials || {};
  const videos = Array.isArray(t.videos) ? t.videos : [];
  return {
    keyword: t.keyword || `${repo.name} 安装教程`,
    searchUrl: biliSearchUrl(repo.name),
    error: t.error || null,
    fetchedAt: t.fetchedAt || null,
    videos: videos.map((v) => ({
      bvid: v.bvid,
      title: v.title,
      author: v.author,
      play: v.play,
      playText: v.playText || formatCount(v.play),
      durationText: v.durationText || '',
      url: v.url || `https://www.bilibili.com/video/${v.bvid}`,
    })),
  };
}

/** 用户视图：只返回前端需要的字段，且历史点已整理成曲线结构 */
export function repoView(repo, now = Date.now()) {
  return {
    name: repo.name,
    owner: repo.owner,
    fullName: repo.fullName,
    url: repo.url,
    homepage: repo.homepage,
    description: repo.description,
    descriptionZh: repo.descriptionZh || '',
    language: repo.language,
    license: repo.license,
    stars: repo.stars,
    starsText: formatCount(repo.stars),
    forks: repo.forks,
    forksText: formatCount(repo.forks),
    openIssues: repo.openIssues,
    archived: Boolean(repo.archived),
    topics: (repo.topics || []).slice(0, 6).map((t) => ({ key: t, zh: topicZh(t) })),
    category: repo.category,
    ageDays: relativeDays(repo.createdAt, now),
    createdAt: repo.createdAt,
    avatar: repo.avatar,
    curve: buildCurve(repo, now),
    tutorials: tutorialView(repo),
  };
}

/** 按固定分区顺序聚合，空分区不输出，「其他」永远排最后 */
export function buildCategories(repos, now = Date.now()) {
  const buckets = new Map();
  for (const repo of repos) {
    if (!buckets.has(repo.category)) buckets.set(repo.category, []);
    buckets.get(repo.category).push(repo);
  }

  const sections = [];
  for (const cat of [...CATEGORIES, OTHER_CATEGORY]) {
    const list = buckets.get(cat.id);
    if (!list || !list.length) continue;
    list.sort((a, b) => b.stars - a.stars);
    sections.push({
      id: cat.id,
      name: cat.name,
      emoji: cat.emoji,
      desc: cat.desc,
      count: list.length,
      repos: list.slice(0, MAX_PER_CATEGORY).map((r) => repoView(r, now)),
    });
  }
  return sections;
}

/**
 * 生成完整响应体
 * @param {{period:object, repos:Array, meta:object, periods:Array, now?:number, extra?:object}} input
 */
export function buildPayload(input) {
  const {
    period, repos, meta = {}, periods = [], now = Date.now(), extra = {},
  } = input;

  const sections = buildCategories(repos, now);
  return {
    ok: true,
    period: period.id,
    periodName: period.name,
    periodNote: period.note,
    generatedAt: new Date(now).toISOString(),
    source: extra.source || 'github-search-api',
    meta: { ...meta, categories: sections.length },
    periods: periods.map((p) => ({ id: p.id, name: p.name })),
    sections,
    ...extra,
  };
}
