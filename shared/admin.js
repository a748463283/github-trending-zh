/**
 * 管理后台权限判定
 *
 * 谁算管理员：在 Cloudflare Pages → Settings → Environment variables 里配置
 * `ADMIN_LOGINS`（逗号分隔的 GitHub 登录名，大小写不敏感）。
 * 未配置时任何人都不是管理员，/admin/ 与 /api/admin/* 一律拒绝。
 */

export function adminLogins(env = {}) {
  const seen = new Set();
  for (const raw of String(env.ADMIN_LOGINS || '').split(',')) {
    const s = raw.trim().toLowerCase();
    if (s) seen.add(s);
  }
  return Array.from(seen);
}

/** 当前 GitHub 登录名是否为管理员 */
export function isAdmin(env, login) {
  if (!login) return false;
  return adminLogins(env).includes(String(login).toLowerCase());
}

/** 管理后台用的用户视图：比公开视图多 B 站 mid、绑定时间等，但不含验证码原文与会话令牌 */
export function adminUserView(user) {
  if (!user) return null;
  const bili = user.bilibili || null;
  const favoriteItems = Array.isArray(user.favoriteItems) ? user.favoriteItems : [];
  return {
    login: user.login || '',
    name: user.name || user.login || '',
    avatar: user.avatar || '',
    htmlUrl: user.htmlUrl || '',
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
    publicProfile: user.publicProfile !== false,
    bilibili: bili && bili.mid
      ? {
        mid: bili.mid,
        verified: Boolean(bili.verified),
        label: bili.label || '',
        linkedAt: bili.linkedAt || null,
        checkedAt: bili.checkedAt || null,
        reason: bili.reason || null,
        spaceUrl: `https://space.bilibili.com/${bili.mid}`,
      }
      : null,
    favoritesCount: favoriteItems.length,
    favorites: favoriteItems,
  };
}
