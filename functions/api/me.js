/**
 * /api/me —— 当前登录用户与个人操作
 *   GET  : 返回登录状态、GitHub 资料、B 站绑定状态、收藏列表
 *   POST : { action: 'favorite' | 'unfavorite' | 'bilibili-code' | 'bind-bilibili'
 *                    | 'verify-bilibili' | 'unbind-bilibili' }
 *
 * 未配置 GitHub OAuth 时 configured=false，前端只显示提示，不影响站点其它功能。
 */

import {
  currentUser, publicUser, isSameOrigin, makeBiliCode,
  sanitizeFavoriteItem, MAX_FAVORITES,
} from '../../shared/auth.js';
import { createUserStore } from '../../shared/user-store.js';
import { fetchUserInfo } from '../../shared/bilibili.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request, env }) {
  const store = createUserStore(env);
  const user = await currentUser(store, request, env);
  return json({
    ok: true,
    configured: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    kvBound: Boolean(env.TRENDING_KV),
    d1Bound: Boolean(env.USER_DB),
    store: store ? store.kind : null,
    user: publicUser(user),
  });
}

async function handleBilibili(user, mid, env) {
  const code = (user.bilibili && user.bilibili.mid === mid && user.bilibili.code)
    || makeBiliCode(user.login);

  const info = await fetchUserInfo(mid, { cookie: env.BILI_COOKIE || undefined });
  let verified = false;
  let label = '';
  let sign = '';
  let reason = null;

  if (info.ok) {
    sign = info.user.sign || '';
    label = info.user.name || '';
    verified = sign.toUpperCase().includes(code.toUpperCase());
    if (!verified) {
      reason = `验证码还没出现在 B 站签名里（读到的签名：${sign || '（空）'}）`;
    }
  } else {
    reason = `B 站接口对本站服务器不可用（${info.error}），已记录绑定，稍后可点「重新校验」`;
  }

  user.bilibili = {
    mid,
    code,
    verified,
    label,
    sign,
    reason,
    linkedAt: (user.bilibili && user.bilibili.linkedAt) || new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return json({ ok: false, error: '跨站请求已被拒绝' }, 403);

  const store = createUserStore(env);
  if (!store) return json({ ok: false, error: '站点未绑定 D1 或 KV，无法保存用户数据' }, 500);

  const user = await currentUser(store, request, env);
  if (!user) return json({ ok: false, error: '请先使用 GitHub 登录' }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }

  const action = String(body.action || '');

  try {
    if (action === 'favorite' || action === 'unfavorite') {
      const fullName = String(body.fullName || '').trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
        return json({ ok: false, error: '仓库名格式不合法' }, 400);
      }

      if (action === 'favorite') {
        const already = (user.favorites || []).includes(fullName);
        if (!already && await store.countFavorites(user.githubId) >= MAX_FAVORITES) {
          return json({ ok: false, error: `收藏已达上限 ${MAX_FAVORITES} 个` }, 400);
        }
        // 前端带上项目快照，清洗后入库；个人主页因此无需再请求 GitHub
        const item = sanitizeFavoriteItem({ ...(body.item || {}), fullName });
        if (!item) return json({ ok: false, error: '项目信息不合法，无法收藏' }, 400);
        const items = await store.addFavorite(user.githubId, item);
        user.favoriteItems = items;
        user.favorites = items.map((i) => i.fullName);
      } else {
        const items = await store.removeFavorite(user.githubId, fullName);
        user.favoriteItems = items;
        user.favorites = items.map((i) => i.fullName);
      }
    } else if (action === 'set-visibility') {
      user.publicProfile = Boolean(body.public);
      await store.updateUser(user);
    } else if (action === 'bilibili-code') {
      if (!user.bilibili || !user.bilibili.code) {
        user.bilibili = {
          mid: null, code: makeBiliCode(user.login), verified: false, label: '', reason: null,
        };
      }
      await store.updateUser(user);
    } else if (action === 'bind-bilibili' || action === 'verify-bilibili') {
      const mid = String(body.mid || (user.bilibili && user.bilibili.mid) || '').trim();
      if (!/^\d{2,12}$/.test(mid)) {
        return json({ ok: false, error: '请填写 B 站数字 UID（个人空间地址里的那串数字）' }, 400);
      }
      await handleBilibili(user, mid, env);
      await store.updateUser(user);
    } else if (action === 'unbind-bilibili') {
      user.bilibili = null;
      await store.updateUser(user);
    } else {
      return json({ ok: false, error: '未知操作' }, 400);
    }
  } catch (err) {
    // 存储写入失败必须如实告知，不能返回“成功”却什么也没存
    return json({ ok: false, error: `保存失败：${err.message || '存储不可用'}` }, 503);
  }

  return json({ ok: true, user: publicUser(user), store: store.kind });
}
