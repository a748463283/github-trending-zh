/**
 * GET /api/auth/login —— 跳转到 GitHub OAuth 授权页
 * 未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 时返回 501 与配置指引（站点其余功能不受影响）。
 */

import { randomToken, serializeCookie, STATE_COOKIE } from '../../../shared/auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return json({
      ok: false,
      configured: false,
      error: '尚未配置 GitHub 登录：请在 Cloudflare Pages → Settings → Environment variables 中添加 GITHUB_CLIENT_ID 与 GITHUB_CLIENT_SECRET。',
      howTo: [
        '1. 打开 https://github.com/settings/developers 新建 OAuth App',
        `2. Homepage URL 填 ${url.origin}`,
        `3. Authorization callback URL 填 ${url.origin}/api/auth/callback`,
        '4. 把生成的 Client ID / Client Secret 填进 Pages 环境变量后重新部署',
      ],
    }, 501);
  }

  const state = randomToken(16);
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'true');

  const headers = new Headers({ location: authorize.toString(), 'cache-control': 'no-store' });
  headers.append('set-cookie', serializeCookie(STATE_COOKIE, state, { maxAge: 600 }));
  return new Response(null, { status: 302, headers });
}
