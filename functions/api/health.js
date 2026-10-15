/**
 * 自检接口：GET /api/health
 * 用于部署后确认绑定与上游连通性（不消耗 AI 额度、不写任何数据）。
 */

import { fetchWbiKeys } from '../../shared/bilibili.js';
import { md5 } from '../../shared/md5.js';
import { currentUser, signSession, sessionSecret } from '../../shared/auth.js';
import { createUserStore } from '../../shared/user-store.js';

/* ---------- 诊断探针：用于定位「登录后仍提示未登录」这类问题 ---------- */

/** KV 读写是否真的可用（免费额度用尽时写入会失败） */
async function probeKv(kv) {
  if (!kv) return { ok: false, error: 'TRENDING_KV 未绑定' };
  const key = 'selftest:v1:kv';
  const stamp = new Date().toISOString();
  try {
    await kv.put(key, stamp, { expirationTtl: 120 });
    const back = await kv.get(key);
    return { ok: back === stamp, wrote: true, readBack: back === stamp };
  } catch (err) {
    return { ok: false, wrote: false, error: String(err.message || err) };
  }
}

/**
 * 会话往返：完全走登录回调用的那条代码路径
 * （saveUser → createSession → 用 Cookie 解析 currentUser）
 * 这一步失败就说明「登录成功但前端拿不到用户」是 KV 侧的问题。
 */
/**
 * 用户存储探针：完整跑一遍「建档 → 查询 → 收藏增删 → 可见性写入并回读」
 * 覆盖 D1 / KV 两种实现；跑完会把测试数据复原，不留痕迹。
 */
async function probeStore(env) {
  const store = createUserStore(env);
  if (!store) return { ok: false, error: '既没有绑定 D1（USER_DB）也没有绑定 KV' };

  const id = 'selftest-0';
  try {
    const profile = {
      githubId: id, login: 'selftest', name: 'selftest', avatar: '', htmlUrl: '',
    };
    const created = await store.upsertProfile(profile);
    const byId = await store.getUserByGithubId(id);
    const byLogin = await store.getUserByLogin('SELFTEST'); // 验证登录名大小写不敏感

    const item = {
      fullName: 'selftest/demo', name: 'demo', owner: 'selftest',
      url: 'https://github.com/selftest/demo', avatar: '', stars: 1, language: '',
      description: '', descriptionZh: '', topics: [], savedAt: new Date().toISOString(),
    };
    const afterAdd = await store.addFavorite(id, item);
    const count = await store.countFavorites(id);
    const afterRemove = await store.removeFavorite(id, item.fullName);

    const updated = await store.updateUser({
      ...(byId || profile),
      publicProfile: false,
      bilibili: {
        mid: '1', code: 'GTZ-TEST', verified: false, label: '', reason: null,
        linkedAt: null, checkedAt: null,
      },
    });
    const afterUpdate = await store.getUserByGithubId(id);

    // 复原，避免留下测试痕迹
    if (afterUpdate) {
      await store.updateUser({ ...afterUpdate, publicProfile: true, bilibili: null });
    }

    return {
      ok: Boolean(byId) && Boolean(byLogin),
      kind: store.kind,
      upserted: Boolean(created),
      readByGithubId: Boolean(byId),
      readByLoginCaseInsensitive: Boolean(byLogin),
      favoriteAddWorked: afterAdd.length === 1,
      favoriteCount: count,
      favoriteRemoveWorked: afterRemove.length === 0,
      visibilityWrite: updated,
      visibilityReadBack: afterUpdate ? afterUpdate.publicProfile === false : null,
    };
  } catch (err) {
    return { ok: false, kind: store.kind, error: String(err.message || err) };
  }
}

/** 签名会话探针：不依赖任何存储也应能签发并校验 */
async function probeSignedSession(env) {
  const secret = sessionSecret(env);
  const signed = await signSession({ g: 'selftest-0', l: 'selftest' }, secret);
  const req = new Request('https://example.com/api/me', {
    headers: { cookie: `gtz_session=${signed || 'none'}` },
  });
  const user = await currentUser(null, req, env);
  return {
    hasSecret: Boolean(secret),
    issued: Boolean(signed),
    verifiedWithoutStore: Boolean(user) && user.login === 'selftest',
  };
}

/**
 * OAuth 凭据校验：用一个「故意无效的 code」去换 token。
 * GitHub 的回应能区分两种失败：
 *   incorrect_client_credentials -> client_id / client_secret 不对
 *   bad_verification_code        -> 凭据正确（只是 code 无效）
 */
async function probeOAuth(env) {
  const clientId = env.GITHUB_CLIENT_ID;
  const secret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !secret) {
    return { ok: false, configured: false, error: '未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET' };
  }
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'github-trending-zh/1.0' },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code: 'selftest-invalid-code' }),
    });
    const json = await res.json();
    const error = json.error || null;
    return {
      configured: true,
      clientIdMasked: `${String(clientId).slice(0, 6)}…${String(clientId).slice(-4)}`,
      secretLength: String(secret).length,
      httpStatus: res.status,
      githubError: error,
      credentialsValid: error !== 'incorrect_client_credentials' && error !== 'invalid_client',
      hint: error === 'incorrect_client_credentials'
        ? 'client_id 或 client_secret 不正确：请核对 OAuth App 的 Client ID 并重新生成 Client Secret'
        : (error === 'bad_verification_code' ? '凭据正确（仅 code 无效，属预期）' : '请查看 githubError'),
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function probeGithub(token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'github-trending-zh/1.0',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch('https://api.github.com/rate_limit', { headers });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    return { ok: true, search: json.resources && json.resources.search };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function probeBilibili(cookie) {
  try {
    const keys = await fetchWbiKeys({ cookie });
    return { ok: true, hasKeys: Boolean(keys.imgKey && keys.subKey) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  // KV 探针会写两条测试键，默认不跑，需要 `?full=1` 才执行（省免费写额度）
  const full = url.searchParams.get('full') === '1';

  const [github, bilibili, oauth] = await Promise.all([
    probeGithub(env.GH_TOKEN),
    probeBilibili(env.BILI_COOKIE || undefined),
    probeOAuth(env),
  ]);

  const diagnostics = full
    ? {
      kvCache: await probeKv(env.TRENDING_KV || null),
      userStore: await probeStore(env),
      signedSession: await probeSignedSession(env),
    }
    : null;

  const body = {
    ok: true,
    time: new Date().toISOString(),
    bindings: {
      TRENDING_KV: Boolean(env.TRENDING_KV),
      USER_DB: Boolean(env.USER_DB),
      AI: Boolean(env.AI),
      GH_TOKEN: Boolean(env.GH_TOKEN),
      BILI_COOKIE: Boolean(env.BILI_COOKIE),
    },
    oauth,
    diagnostics,
    upstream: { github, bilibili },
    // 自检：内置 MD5 的已知向量（WBI 签名依赖它）
    selfTest: {
      'md5("abc")': md5('abc'),
      'md5("哔哩哔哩")': md5('哔哩哔哩'),
      expected: { 'md5("abc")': '900150983cd24fb0d6963f7d28e17f72' },
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
