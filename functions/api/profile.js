/**
 * GET /api/profile?u=<github登录名> —— 公开个人主页数据（收藏列表 + B 站绑定）
 *
 * 只返回公开字段：不含验证码、GitHub ID、会话令牌。
 * 用户可在个人页把收藏设为「不公开」，此时接口返回 403。
 * 收藏列表来自收藏时写入 KV 的项目快照，因此**不依赖 GitHub 接口配额**。
 */

import { publicProfile } from '../../shared/auth.js';
import { createUserStore } from '../../shared/user-store.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
});

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const login = (url.searchParams.get('u') || url.searchParams.get('login') || '').trim();

  if (!/^[\w-]{1,39}$/.test(login)) {
    return json({ ok: false, error: '请提供合法的 GitHub 用户名' }, 400, { 'cache-control': 'no-store' });
  }

  const store = createUserStore(env);
  if (!store) {
    return json({ ok: false, error: '站点未绑定 D1 或 KV，无法读取用户数据' }, 500, { 'cache-control': 'no-store' });
  }

  const user = await store.getUserByLogin(login);
  if (!user) {
    return json({
      ok: false,
      error: '没有找到这个用户：他还没有用 GitHub 登录过本站',
    }, 404, { 'cache-control': 'no-store' });
  }
  if (user.publicProfile === false) {
    return json({ ok: false, error: '该用户没有公开自己的收藏页' }, 403, { 'cache-control': 'no-store' });
  }

  return json({ ok: true, profile: publicProfile(user), store: store.kind }, 200, {
    'cache-control': 'public, max-age=60',
  });
}
