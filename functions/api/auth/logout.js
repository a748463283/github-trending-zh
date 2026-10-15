/**
 * GET /api/auth/logout —— 退出登录：删除服务端会话（若有）并清 Cookie
 */

import { parseCookies, serializeCookie, SESSION_COOKIE } from '../../../shared/auth.js';
import { createUserStore } from '../../../shared/user-store.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const store = createUserStore(env);
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];

  // 签名 Cookie 是无状态的，服务端只需清 Cookie；
  // 旧 KV 会话才需要额外删除服务端记录。
  if (token && store && typeof store.deleteSession === 'function') {
    await store.deleteSession(token);
  }

  const headers = new Headers({ location: `${url.origin}/?auth=logout`, 'cache-control': 'no-store' });
  headers.append('set-cookie', serializeCookie(SESSION_COOKIE, '', { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

export async function onRequestPost(context) {
  return onRequestGet(context);
}
