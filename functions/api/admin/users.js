/**
 * GET /api/admin/users —— 管理后台：分页列出所有已登录用户（含收藏与 B 站绑定）
 *
 * 权限：仅 ADMIN_LOGINS 里配置的 GitHub 登录名可访问（读签名 Cookie 判定登录）。
 * 存储：需要 D1（USER_DB）；KV 兜底无法枚举用户，会明确返回不支持。
 */

import { currentUser } from '../../../shared/auth.js';
import { isAdmin, adminUserView } from '../../../shared/admin.js';
import { createUserStore } from '../../../shared/user-store.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request, env }) {
  const store = createUserStore(env);
  const user = await currentUser(store, request, env);
  if (!user) return json({ ok: false, error: '请先登录', needLogin: true }, 401);
  if (!isAdmin(env, user.login)) return json({ ok: false, error: '没有管理员权限', forbidden: true }, 403);
  if (!store || typeof store.listUsers !== 'function') {
    return json({ ok: false, error: '管理后台需要 D1 存储（当前存储无法枚举用户）', unsupported: true }, 501);
  }

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const { total, users } = await store.listUsers({ limit, offset });

  return json({
    ok: true,
    store: store.kind,
    admin: { login: user.login, avatar: user.avatar || '', name: user.name || user.login },
    total,
    limit,
    offset,
    users: users.map(adminUserView),
  });
}
