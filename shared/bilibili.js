/**
 * 哔哩哔哩教程检索客户端（Workers / Node 通用）
 *
 * 为什么要自己实现 WBI 签名：
 *   B 站搜索接口 /x/web-interface/wbi/search/type 需要 w_rid 签名，
 *   密钥来自 /x/web-interface/nav 的 wbi_img（img_key + sub_key），
 *   经固定置换表混合后再对「已排序参数 + mixinKey」做 MD5。
 *   匿名也能拿到密钥，因此本站无需登录即可检索真实教程视频。
 *
 * 失败策略：任何异常（风控 -352、超时、解析失败）都返回空列表并带上原因，
 * 前端会自动降级为「B 站搜索链接」，保证页面永远可用。
 */

import { md5 } from './md5.js';
import { cleanText, parseBiliDuration } from './text-utils.js';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SEARCH_ENDPOINT = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
const NAV_ENDPOINT = 'https://api.bilibili.com/x/web-interface/nav';

function mixinKey(imgKey, subKey) {
  const orig = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

/** 生成 w_rid 与带签名的 query string */
export function wbiSign(params, imgKey, subKey, now = Date.now()) {
  const mixin = mixinKey(imgKey, subKey);
  const wts = Math.floor(now / 1000);
  const all = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map((k) => {
      const v = String(all[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  return { query, w_rid: md5(query + mixin), wts };
}

function biliHeaders(cookie, referer) {
  const headers = { 'user-agent': UA, referer: referer || 'https://www.bilibili.com/' };
  if (cookie) headers.cookie = cookie;
  return headers;
}

/** 取 WBI 密钥（img_key / sub_key） */
export async function fetchWbiKeys(opts = {}) {
  const { cookie, fetchImpl = fetch, timeoutMs = 8000 } = opts;
  const res = await fetchImpl(NAV_ENDPOINT, {
    headers: biliHeaders(cookie),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bili nav HTTP ${res.status}`);
  const json = await res.json();
  const wbi = json && json.data && json.data.wbi_img;
  if (!wbi || !wbi.img_url || !wbi.sub_url) throw new Error('bili nav 未返回 wbi_img');
  return {
    imgKey: wbi.img_url.slice(wbi.img_url.lastIndexOf('/') + 1).split('.')[0],
    subKey: wbi.sub_url.slice(wbi.sub_url.lastIndexOf('/') + 1).split('.')[0],
  };
}

/**
 * 查询 B 站用户公开信息（用于「关联 B 站」时校验验证码是否写在个人签名里）
 * 走 WBI 签名的 /x/space/wbi/acc/info 接口；失败时返回 { ok:false, error }，由调用方如实标注「待验证」。
 */
export async function fetchUserInfo(mid, opts = {}) {
  const {
    cookie, fetchImpl = fetch, keys, timeoutMs = 8000, now = Date.now(),
  } = opts;

  try {
    const wbi = keys || (await fetchWbiKeys({ cookie, fetchImpl, timeoutMs }));
    const params = {
      mid: String(mid), token: '', platform: 'web', web_location: '1550101',
    };
    const { query, w_rid } = wbiSign(params, wbi.imgKey, wbi.subKey, now);
    const res = await fetchImpl(
      `https://api.bilibili.com/x/space/wbi/acc/info?${query}&w_rid=${w_rid}`,
      {
        headers: biliHeaders(cookie, `https://space.bilibili.com/${mid}`),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    if (json.code !== 0) {
      return { ok: false, error: `B站返回 code=${json.code} ${json.message || ''}`.trim() };
    }
    const d = json.data || {};
    return {
      ok: true,
      user: {
        mid: String(d.mid || mid),
        name: cleanText(d.name || ''),
        sign: cleanText(d.sign || ''),
        face: d.face || '',
        level: Number(d.level) || 0,
      },
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/** 教程类标题特征词（视频必须命中至少一个，才被认为是「讲这个项目的教程/介绍」） */
const TUTORIAL_WORDS = [
  '教程', '安装', '部署', '搭建', '入门', '教学', '配置', '汉化', '保姆', '使用',
  '从零', '实战', '零基础', '踩坑', '上手', '怎么', '如何', '指南', '详解', '讲解',
  '手把手', '新手', '教你', '攻略', '介绍', '演示', '实测', '解读', '解析', '评测',
  '对比', '探究', '安装包', '开源',
];

/** 明显不是教程的标题特征（降低权重） */
const NOISE_WORDS = ['广告', '招聘', '抽奖', '带货', '直播回放', '花絮'];

/**
 * 给一个视频打「教程相关度」分数。
 * 硬性要求（宁缺毋滥，不满足直接 0 分）：
 *   1) 标题里出现项目名（或作者名）——确保是讲这个项目的；
 *   2) 标题里出现教程/介绍类词——确保是教程或介绍，而不是同名无关内容。
 * 不满足时前端会退回「B 站搜索链接」。
 */
export function scoreTutorial(video, keywords) {
  const title = String(video.title || '').toLowerCase();
  if (!title) return 0;

  const names = (Array.isArray(keywords) ? keywords : [keywords])
    .map((k) => String(k || '').toLowerCase().replace(/[-_]/g, ' ').trim())
    .filter((k) => k.length >= 3);

  let nameHit = false;
  for (const name of names) {
    if (title.includes(name) || title.includes(name.replace(/\s+/g, ''))) {
      nameHit = true;
      break;
    }
  }
  if (!nameHit) return 0;

  const wordHits = TUTORIAL_WORDS.filter((w) => title.includes(w)).length;
  if (wordHits === 0) return 0;

  let score = 6 + 2 + Math.min(wordHits, 3);
  if (NOISE_WORDS.some((w) => title.includes(w))) score -= 6;

  // 教程视频通常 2 分钟到 2 小时之间
  if (video.duration >= 120 && video.duration <= 7200) score += 2;
  if (video.duration > 0 && video.duration < 60) score -= 3;
  if (video.play >= 1000) score += 1;
  if (video.play >= 50000) score += 1;

  return score;
}

const MIN_TUTORIAL_SCORE = 6;

/**
 * 为一个项目找 B 站安装教程
 * @param {{name:string, owner?:string}} repo
 * @returns {Promise<{keyword:string, videos:Array, error?:string}>}
 */
export async function findTutorials(repo, opts = {}) {
  const { limit = 3, ...rest } = opts;
  const keyword = `${repo.name} 安装教程`;
  const { videos, error } = await searchVideos(keyword, { ...rest, pageSize: 10 });
  if (error) return { keyword, videos: [], error };

  const ranked = videos
    .map((v) => ({ ...v, score: scoreTutorial(v, [repo.name, repo.owner]) }))
    .filter((v) => v.score >= MIN_TUTORIAL_SCORE)
    .sort((a, b) => b.score - a.score || b.play - a.play)
    .slice(0, limit)
    .map(({ score, ...v }) => v);

  return { keyword, videos: ranked };
}

/**
 * 批量补教程，带节流与数量上限，避免触发风控。
 * 已经存在 tutorials 的仓库会跳过（增量填充）；
 * 连续失败（例如 Cloudflare 出口 IP 被 B 站风控返回 412）会提前熔断，不做无谓请求。
 */
export async function attachTutorials(repos, opts = {}) {
  const {
    budget = 12, delayMs = 350, cookie, fetchImpl = fetch, now = Date.now(),
    maxConsecutiveErrors = 2,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  let keys = null;
  try {
    keys = await fetchWbiKeys({ cookie, fetchImpl });
  } catch {
    keys = null; // 取密钥失败时逐个调用里还会再试一次
  }

  let used = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  let aborted = false;

  for (const repo of repos) {
    if (used >= budget) break;
    if (repo.tutorials && repo.tutorials.videos && repo.tutorials.videos.length) continue;
    if (repo.tutorials && repo.tutorials.error && !opts.retryFailed) continue;

    const result = await findTutorials(repo, { cookie, fetchImpl, keys, now });
    repo.tutorials = {
      keyword: result.keyword,
      videos: result.videos,
      error: result.error || null,
      fetchedAt: new Date(now).toISOString(),
    };
    used += 1;

    if (result.error) {
      errors += 1;
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        aborted = true;
        break;
      }
    } else {
      consecutiveErrors = 0;
    }
    if (delayMs > 0 && used < budget) await sleep(delayMs);
  }

  return { used, errors, hasKeys: Boolean(keys), aborted };
}

/**
 * 调用 B 站 WBI 搜索接口
 * @returns {Promise<{videos:Array, error?:string}>}
 */
export async function searchVideos(keyword, opts = {}) {
  const {
    cookie, fetchImpl = fetch, pageSize = 8, order = 'totalrank',
    keys, timeoutMs = 8000, now = Date.now(),
  } = opts;

  try {
    const wbi = keys || (await fetchWbiKeys({ cookie, fetchImpl, timeoutMs }));
    const params = {
      search_type: 'video',
      keyword,
      page: 1,
      page_size: pageSize,
      order,
    };
    const { query, w_rid } = wbiSign(params, wbi.imgKey, wbi.subKey, now);
    const res = await fetchImpl(`${SEARCH_ENDPOINT}?${query}&w_rid=${w_rid}`, {
      headers: biliHeaders(cookie, `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { videos: [], error: `HTTP ${res.status}` };
    const json = await res.json();
    if (json.code !== 0) return { videos: [], error: `B站返回 code=${json.code} ${json.message || ''}`.trim() };
    const list = (json.data && json.data.result) || [];
    const videos = list
      .filter((v) => v && v.bvid && v.title)
      .map((v) => ({
        bvid: v.bvid,
        title: cleanText(v.title),
        author: cleanText(v.author || ''),
        play: Number(v.play) || 0,
        durationText: v.duration || '',
        duration: parseBiliDuration(v.duration),
        pubdate: v.pubdate || 0,
        url: `https://www.bilibili.com/video/${v.bvid}`,
      }));
    return { videos };
  } catch (err) {
    return { videos: [], error: String((err && err.message) || err) };
  }
}
