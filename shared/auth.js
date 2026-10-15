/**
 * 登录与会话（Cloudflare Pages Functions / 本地脚本共用）
 *
 * 设计取舍：
 *   - GitHub OAuth 需要自建 OAuth App（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET），
 *     未配置时全部接口返回明确提示，站点其余功能不受影响（优雅降级）。
 *   - 会话用 **HMAC 签名 Cookie**（无状态），不依赖任何存储写入；
 *     用户资料 / 收藏 / B 站绑定交给 shared/user-store.js（D1 优先，KV 兜底）。
 *   - 所有写操作校验同源，防 CSRF。
 *   - B 站绑定采用「UID + 验证码」方案：不依赖 B 站开放平台审核，
 *     验证码需填写到 B 站个人签名，服务端尽力自动校验；校验不可达时状态如实标为「待验证」。
 */

export const SESSION_COOKIE = 'gtz_session';
export const STATE_COOKIE = 'gtz_state';
export const SESSION_TTL = 60 * 60 * 24 * 30;
export const BILI_CODE_PREFIX = 'GTZ';

// 收藏上限定义在存储层，这里透出以保持既有引用可用
export { MAX_FAVORITES } from './user-store.js';

/** 解析 Cookie 头 */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** 生成 Set-Cookie 字符串 */
export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || '/'}`];
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure !== false) parts.push('Secure');
  if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}

/** 随机令牌 */
export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 读取当前登录用户
 *   1) 先看无状态签名 Cookie（不依赖任何存储写入）
 *   2) 再兼容旧的 KV 会话（仅当存储实现提供 getSession 时）
 * @param {object|null} store 来自 createUserStore(env)
 * 无会话时返回 null。
 */
export async function currentUser(store, request, env = {}) {
  const cookies = parseCookies(request.headers ? request.headers.get('cookie') : '');
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  const signed = await verifySession(raw, sessionSecret(env));
  if (signed) {
    const user = {
      githubId: String(signed.g),
      login: signed.l || '',
      name: signed.n || signed.l || '',
      avatar: signed.a || '',
      htmlUrl: signed.u || '',
      createdAt: signed.c || null,
      publicProfile: signed.p !== false,
      favorites: [],
      favoriteItems: [],
      bilibili: null,
      sessionMode: 'signed-cookie',
    };

    // 尽力合并存储里的收藏 / B 站绑定；读不到也不影响登录本身
    if (store) {
      const record = await store.getUserByGithubId(user.githubId);
      if (record) {
        return {
          ...record,
          // 存储里的资料优先，但 cookie 是身份的来源
          githubId: user.githubId,
          sessionMode: 'signed-cookie',
        };
      }
    }
    return user;
  }

  // 降级路径：旧 KV 会话（只有 KV 存储实现支持）
  if (!store || typeof store.getSession !== 'function') return null;
  const githubId = await store.getSession(raw);
  if (!githubId) return null;
  const legacy = await store.getUserByGithubId(githubId);
  return legacy ? { ...legacy, sessionToken: raw, sessionMode: 'kv' } : null;
}

/* ---------- 无状态签名会话（HMAC-SHA256） ----------
 * 为什么默认用它：KV 免费额度是「1000 次写/天」，
 * 会话若只存 KV，额度用尽时**连登录都会失败**。
 * 改成签名 Cookie 后，登录只依赖一次 GitHub 校验 + 一次 HMAC 计算，
 * 完全不吃 KV 写额度（收藏、B 站绑定等数据仍存 KV）。
 * 旧的 KV 会话仍然兼容，作为降级路径保留。
 */

export function sessionSecret(env = {}) {
  // 优先专用密钥；未配置时退回 GitHub Client Secret（零额外配置，但建议单独设 SESSION_SECRET）
  return env.SESSION_SECRET || env.GITHUB_CLIENT_SECRET || '';
}

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlJson(obj) {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function fromBase64url(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`gtz-session-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** 生成签名会话值；没有密钥时返回 null */
export async function signSession(payload, secret, nowMs = Date.now()) {
  if (!secret) return null;
  const body = base64urlJson({ ...payload, e: Math.floor(nowMs / 1000) + SESSION_TTL });
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(sig))}`;
}

/** 校验签名会话；被篡改、过期、密钥不符都返回 null */
export async function verifySession(token, secret, nowMs = Date.now()) {
  if (!token || !secret || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      'HMAC', key, fromBase64url(sig), new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    if (!payload || !payload.g || !Number.isFinite(payload.e)) return null;
    if (payload.e < Math.floor(nowMs / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 只允许来自本站的写操作（配合 SameSite=Lax Cookie） */
export function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // 同站表单/无 Origin 的简单请求
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function makeBiliCode(login) {
  const seed = `${login}-${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 0xffffff;
  }
  return `${BILI_CODE_PREFIX}-${hash.toString(16).toUpperCase().padStart(6, '0')}`;
}

/** 对外暴露的用户视图（验证码需要给本人复制，故一并返回） */
export function publicUser(user) {
  if (!user) return null;
  return {
    login: user.login,
    name: user.name || user.login,
    avatar: user.avatar,
    htmlUrl: user.htmlUrl,
    createdAt: user.createdAt,
    bilibili: user.bilibili
      ? {
        mid: user.bilibili.mid || null,
        code: user.bilibili.code || '',
        verified: Boolean(user.bilibili.verified),
        label: user.bilibili.label || '',
        spaceUrl: user.bilibili.mid ? `https://space.bilibili.com/${user.bilibili.mid}` : null,
        checkedAt: user.bilibili.checkedAt || null,
        reason: user.bilibili.reason || null,
      }
      : null,
    favorites: Array.isArray(user.favorites) ? user.favorites : [],
    favoriteItems: Array.isArray(user.favoriteItems) ? user.favoriteItems : [],
    publicProfile: user.publicProfile !== false,
  };
}

/** 公开个人主页视图：不含验证码、GitHub ID、会话等内部字段 */
export function publicProfile(user) {
  if (!user) return null;
  const bili = user.bilibili && user.bilibili.mid
    ? {
      mid: user.bilibili.mid,
      verified: Boolean(user.bilibili.verified),
      label: user.bilibili.label || '',
      spaceUrl: `https://space.bilibili.com/${user.bilibili.mid}`,
    }
    : null;

  const items = Array.isArray(user.favoriteItems) ? user.favoriteItems : [];
  return {
    login: user.login,
    name: user.name || user.login,
    avatar: user.avatar,
    htmlUrl: user.htmlUrl,
    createdAt: user.createdAt,
    bilibili: bili,
    favorites: items,
    favoritesCount: Array.isArray(user.favorites) ? user.favorites.length : items.length,
  };
}

const clip = (value, max) => String(value == null ? '' : value)
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

/**
 * 校验并清洗前端提交的「收藏项目快照」。
 * 这样个人主页渲染只依赖 KV，不需要为每个收藏去调 GitHub 接口（避开限流）。
 * @returns {object|null} 合法则返回清洗后的记录，否则 null
 */
export function sanitizeFavoriteItem(input) {
  if (!input || typeof input !== 'object') return null;

  const fullName = clip(input.fullName, 120);
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return null;
  const [ownerFromName, nameFromName] = fullName.split('/');

  const rawUrl = String(input.url || '');
  const url = /^https:\/\/github\.com\//.test(rawUrl)
    ? rawUrl.slice(0, 200)
    : `https://github.com/${fullName}`;

  const rawAvatar = String(input.avatar || '');
  const avatar = /^https:\/\/[\w.-]+\//.test(rawAvatar) ? rawAvatar.slice(0, 300) : '';

  const topics = Array.isArray(input.topics)
    ? input.topics.slice(0, 5)
      .map((t) => ({ key: clip(t && t.key, 40), zh: clip(t && t.zh, 40) }))
      .filter((t) => t.key || t.zh)
    : [];

  const stars = Number(input.stars);

  return {
    fullName,
    owner: clip(input.owner, 60) || ownerFromName,
    name: clip(input.name, 80) || nameFromName,
    url,
    avatar,
    stars: Number.isFinite(stars) && stars >= 0 ? Math.floor(stars) : 0,
    language: clip(input.language, 30),
    description: clip(input.description, 300),
    descriptionZh: clip(input.descriptionZh, 300),
    topics,
    savedAt: new Date().toISOString(),
  };
}
