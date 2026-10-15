/** 文本处理工具（前后端共用，零依赖） */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  ldquo: '“', rdquo: '”', hellip: '…', middot: '·',
};

/** 解码 HTML 实体 + 去掉标签（B 站接口返回带 <em class="keyword"> 高亮） */
export function cleanText(input) {
  if (input == null) return '';
  return String(input)
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (m, name) => {
      if (ENTITIES[name] != null) return ENTITIES[name];
      if (/^#\d+$/.test(name)) {
        const code = Number(name.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 数值友好化：12345 -> 1.2 万 */
export function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, '')} 亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

/** B 站时长：'706:42' 或 '13:24' -> 秒；异常值返回 0 */
export function parseBiliDuration(duration) {
  if (!duration) return 0;
  const parts = String(duration).split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/** 秒 -> '13:24' / '2:06:42' */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 生成 B 站搜索链接（永远可用的兜底入口） */
export function biliSearchUrl(keyword) {
  const q = encodeURIComponent(`${keyword} 安装教程`);
  return `https://search.bilibili.com/all?keyword=${q}`;
}

/** 生成 B 站视频链接 */
export function biliVideoUrl(bvid) {
  return bvid ? `https://www.bilibili.com/video/${bvid}` : biliSearchUrl('');
}

export function relativeDays(isoDate, now = Date.now()) {
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 86400000));
}
