/**
 * Star 增长曲线：数据收集与曲线计算（Function / 构建脚本 共用）
 *
 * 重要说明：GitHub 官方 API **不提供历史 Star 数据**，只给当前值。
 * 因此本站的曲线由两部分组成：
 *   1) 实测点：每次刷新数据时，把「时间 + 当前 Star」追加到 KV，日积月累形成真实曲线；
 *   2) 推算线：实测点不足 2 个时，用「创建至今的日平均增速」画一条虚线推算曲线，
 *      并在界面上明确标注为「按日均增速推算」，绝不伪装成实测数据。
 */

const MAX_POINTS = 90;
const MIN_INTERVAL_SECONDS = 24 * 3600; // 每个仓库每天最多采样一次
// 单次刷新最多为多少个仓库采样：KV 免费额度是「1000 次写/天」，
// 必须给登录、收藏等用户写入留出余量（见 README「KV 写入预算」）。
export const DEFAULT_SAMPLE_LIMIT = 40;

export const starKey = (fullName) => `star:v1:${fullName}`;

/** 读取一个仓库的历史点 */
export async function readHistory(kv, fullName) {
  if (!kv) return null;
  try {
    const raw = await kv.get(starKey(fullName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed && parsed.points) ? parsed.points : null;
  } catch {
    return null;
  }
}

/** 并发受限地读取一批仓库的历史 */
export async function loadHistories(repos, kv, concurrency = 12) {
  if (!kv) return 0;
  let hit = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < repos.length) {
      const repo = repos[cursor];
      cursor += 1;
      const points = await readHistory(kv, repo.fullName);
      if (points && points.length) {
        repo.starPoints = points;
        hit += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return hit;
}

/**
 * 追加当前数据点并写回 KV（只在距上次记录超过 MIN_INTERVAL_SECONDS 时写入）
 * @param {object} opts { maxRepos, now } —— maxRepos 控制单次采样上限，保护 KV 写额度
 * @returns {Promise<{written:number, skipped:number, capped:number}>}
 */
export async function appendHistories(repos, kv, now = Date.now(), opts = {}) {
  const maxRepos = Number.isFinite(opts.maxRepos) ? opts.maxRepos : DEFAULT_SAMPLE_LIMIT;
  if (!kv) return { written: 0, skipped: repos.length, capped: 0 };

  const ts = Math.floor(now / 1000);
  let written = 0;
  let skipped = 0;
  let capped = 0;
  let budget = maxRepos;

  // 按 Star 降序采样：热度高的项目优先拿到真实曲线
  const ordered = [...repos].sort((a, b) => (b.stars || 0) - (a.stars || 0));

  await Promise.all(ordered.map(async (repo) => {
    const points = Array.isArray(repo.starPoints) ? repo.starPoints : [];
    const last = points[points.length - 1];
    if (last && ts - last[0] < MIN_INTERVAL_SECONDS) {
      skipped += 1;
      return;
    }
    if (budget <= 0) {
      capped += 1;
      return;
    }
    budget -= 1;

    const next = [...points, [ts, repo.stars]].slice(-MAX_POINTS);
    repo.starPoints = next;
    try {
      // TTL 一年，避免长期不活跃的仓库占满存储
      await kv.put(starKey(repo.fullName), JSON.stringify({ points: next }), {
        expirationTtl: 60 * 60 * 24 * 365,
      });
      written += 1;
    } catch {
      /* 写失败（例如额度用尽）不影响响应，下次刷新会重试 */
    }
  }));

  return { written, skipped, capped };
}

/**
 * 把历史点与推算信息整理成前端可渲染的结构
 * @returns {{points:number[][], source:'measured'|'projected', delta:number|null, days:number|null, perDay:number|null}}
 */
export function buildCurve(repo, now = Date.now()) {
  const measured = Array.isArray(repo.starPoints) ? repo.starPoints.filter(
    (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  ) : [];

  const createdTs = Math.floor(new Date(repo.createdAt).getTime() / 1000);
  const nowTs = Math.floor(now / 1000);
  const ageDays = Number.isFinite(createdTs) && createdTs > 0
    ? Math.max(1, Math.round((nowTs - createdTs) / 86400)) : null;

  if (measured.length >= 2) {
    const [firstTs, firstStars] = measured[0];
    const [lastTs, lastStars] = measured[measured.length - 1];
    const days = Math.max(1, (lastTs - firstTs) / 86400);
    return {
      points: measured,
      source: 'measured',
      delta: lastStars - firstStars,
      days: Math.round(days),
      perDay: Math.round((lastStars - firstStars) / days),
    };
  }

  // 实测点不足：用「创建 -> 现在」的日均增速画推算线
  if (ageDays && repo.stars > 0) {
    return {
      points: [[createdTs, 0], [nowTs, repo.stars]],
      source: 'projected',
      delta: repo.stars,
      days: ageDays,
      perDay: Math.round(repo.stars / ageDays),
    };
  }

  return {
    points: [], source: 'projected', delta: null, days: null, perDay: null,
  };
}
