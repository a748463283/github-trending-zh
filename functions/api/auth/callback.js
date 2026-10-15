/**
 * GET /api/auth/callback —— GitHub OAuth 回调：换 token、取用户、写 KV、建会话
 * 只保存身份资料与绑定信息，**不保存 access token**。
 */

import {
  parseCookies, serializeCookie, signSession, sessionSecret,
  SESSION_COOKIE, STATE_COOKIE, SESSION_TTL,
} from '../../../shared/auth.js';
import { createUserStore } from '../../../shared/user-store.js';

const UA = 'github-trending-zh/1.0';

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('cookie'));
  const fail = (reason) => redirect(`${url.origin}/?auth=${reason}`, [
    serializeCookie(STATE_COOKIE, '', { maxAge: 0 }),
  ]);

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail('not_configured');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return fail(url.searchParams.get('error') ? 'denied' : 'no_code');
  if (!state || state !== cookies[STATE_COOKIE]) return fail('state_mismatch');

  // 1) code -> access token
  let accessToken = '';
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/api/auth/callback`,
      }),
    });
    const tokenJson = await tokenRes.json();
    accessToken = tokenJson.access_token || '';
  } catch {
    return fail('exchange_error');
  }
  if (!accessToken) return fail('exchange_failed');

  // 2) 取 GitHub 资料
  let profile;
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/vnd.github+json',
        'user-agent': UA,
      },
    });
    if (!res.ok) return fail('profile_failed');
    profile = await res.json();
  } catch {
    return fail('profile_error');
  }

  // 3) 写用户资料 + 签发会话
  //    会话是签名 Cookie，不依赖存储写入；资料写失败只降级为「收藏暂不可用」。
  // 落库用户资料（收藏 / B 站绑定要用）。写失败不阻断登录：
  // 会话本身是签名 Cookie，不依赖存储写入，所以存储不可用时也能登录。
  const store = createUserStore(env);
  if (!store) return fail('storage_missing');

  const stored = await store.upsertProfile({
    githubId: String(profile.id),
    login: profile.login,
    name: profile.name || profile.login,
    avatar: profile.avatar_url || '',
    htmlUrl: profile.html_url || `https://github.com/${profile.login}`,
  });

  // 存储写失败时用 GitHub 返回的资料兜底，身份仍然可用
  const identity = stored || {
    githubId: String(profile.id),
    login: profile.login,
    name: profile.name || profile.login,
    avatar: profile.avatar_url || '',
    htmlUrl: profile.html_url || `https://github.com/${profile.login}`,
    createdAt: new Date().toISOString(),
    publicProfile: true,
  };

  const signed = await signSession({
    g: identity.githubId,
    l: identity.login,
    n: identity.name,
    a: identity.avatar,
    u: identity.htmlUrl,
    c: identity.createdAt,
    p: identity.publicProfile !== false,
  }, sessionSecret(env));

  // 没有可用签名密钥时才退回 KV 会话（KV 存储实现提供 createSession）
  const sessionValue = signed
    || (typeof store.createSession === 'function' ? await store.createSession(identity.githubId) : null);
  if (!sessionValue) return fail('session_unavailable');

  return redirect(`${url.origin}/?auth=${stored ? 'ok' : 'ok_degraded'}`, [
    serializeCookie(SESSION_COOKIE, sessionValue, { maxAge: SESSION_TTL }),
    serializeCookie(STATE_COOKIE, '', { maxAge: 0 }),
  ]);
}
