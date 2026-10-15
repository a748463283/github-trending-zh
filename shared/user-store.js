/**
 * 用户数据存储抽象
 *
 *   D1（SQLite）优先：免费额度 10 万行写/天，远优于 KV 的 1000 次写/天，
 *   适合「用户 / 收藏 / 绑定」这类会随用户操作频繁写入的数据。
 *   未绑定 D1 时自动回退旧 KV 实现，保证没有 D1 也能跑。
 *
 * 两个实现提供同一组方法：
 *   kind
 *   getUserByGithubId(id) / getUserByLogin(login)
 *   upsertProfile(profile)        登录时写基础资料（保留收藏与绑定）
 *   updateUser(user)              更新可见性 / B 站绑定
 *   addFavorite(id, item) / removeFavorite(id, fullName) / listFavorites(id)
 *   createSession(id) / deleteSession(token) / getSession(token)   （仅 KV 实现）
 *
 * 缓存类数据（聚合、翻译、教程、Star 采样）仍然放 KV，两者分工明确。
 */

export const MAX_FAVORITES = 500;

function safeTopics(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => ({ key: String((t && t.key) || ''), zh: String((t && t.zh) || '') }))
      .filter((t) => t.key || t.zh);
  } catch {
    return [];
  }
}

const USER_FIELDS = 'github_id, login, name, avatar, html_url, created_at, last_login_at, '
  + 'public_profile, bili_mid, bili_code, bili_verified, bili_label, bili_sign, '
  + 'bili_reason, bili_linked_at, bili_checked_at';

function rowToUser(row, favoriteItems) {
  if (!row) return null;
  return {
    githubId: String(row.github_id),
    login: row.login || '',
    name: row.name || row.login || '',
    avatar: row.avatar || '',
    htmlUrl: row.html_url || '',
    createdAt: row.created_at || null,
    lastLoginAt: row.last_login_at || null,
    publicProfile: Number(row.public_profile) !== 0,
    bilibili: row.bili_mid
      ? {
        mid: String(row.bili_mid),
        code: row.bili_code || '',
        verified: Number(row.bili_verified) === 1,
        label: row.bili_label || '',
        sign: row.bili_sign || '',
        reason: row.bili_reason || null,
        linkedAt: row.bili_linked_at || null,
        checkedAt: row.bili_checked_at || null,
      }
      : null,
    favorites: favoriteItems.map((f) => f.fullName),
    favoriteItems,
  };
}

function rowToFavorite(row) {
  return {
    fullName: row.full_name,
    name: row.name || '',
    owner: row.owner || '',
    url: row.url || '',
    avatar: row.avatar || '',
    stars: Number(row.stars) || 0,
    language: row.language || '',
    description: row.description || '',
    descriptionZh: row.description_zh || '',
    topics: safeTopics(row.topics),
    savedAt: row.saved_at,
  };
}

/* ---------- D1 实现 ---------- */

export function createD1Store(db) {
  async function listFavorites(githubId) {
    // saved_at 可能相同（同一毫秒内收藏两条），用 rowid 兜底保证顺序确定：后插入的在前
    const { results } = await db.prepare(
      `SELECT full_name, name, owner, url, avatar, stars, language, description,
              description_zh, topics, saved_at
         FROM favorites WHERE github_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT ?`,
    ).bind(String(githubId), MAX_FAVORITES).all();
    return (results || []).map(rowToFavorite);
  }

  async function getUserByGithubId(githubId) {
    const row = await db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE github_id = ?`)
      .bind(String(githubId)).first();
    if (!row) return null;
    return rowToUser(row, await listFavorites(githubId));
  }

  async function getUserByLogin(login) {
    const row = await db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE login = ? COLLATE NOCASE`)
      .bind(String(login)).first();
    if (!row) return null;
    return rowToUser(row, await listFavorites(row.github_id));
  }

  /** 登录时写入基础资料；已存在则只更新登录相关字段，收藏/绑定不受影响 */
  async function upsertProfile(profile) {
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO users (github_id, login, name, avatar, html_url, created_at, last_login_at, public_profile)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(github_id) DO UPDATE SET
         login = excluded.login,
         name = excluded.name,
         avatar = excluded.avatar,
         html_url = excluded.html_url,
         last_login_at = excluded.last_login_at`,
    ).bind(
      String(profile.githubId), profile.login || '', profile.name || '',
      profile.avatar || '', profile.htmlUrl || '', now, now,
    ).run();
    return getUserByGithubId(profile.githubId);
  }

  /** 更新可见性与 B 站绑定（收藏单独走 favorites 表） */
  async function updateUser(user) {
    const b = user.bilibili || {};
    try {
      await db.prepare(
        `UPDATE users SET
           public_profile = ?, bili_mid = ?, bili_code = ?, bili_verified = ?,
           bili_label = ?, bili_sign = ?, bili_reason = ?,
           bili_linked_at = ?, bili_checked_at = ?
         WHERE github_id = ?`,
      ).bind(
        user.publicProfile === false ? 0 : 1,
        b.mid || null, b.code || null, b.verified ? 1 : 0, b.label || null, b.sign || null,
        b.reason || null, b.linkedAt || null, b.checkedAt || null,
        String(user.githubId),
      ).run();
      return true;
    } catch {
      return false;
    }
  }

  async function addFavorite(githubId, item) {
    await db.prepare(
      `INSERT INTO favorites
         (github_id, full_name, name, owner, url, avatar, stars, language,
          description, description_zh, topics, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id, full_name) DO UPDATE SET
         stars = excluded.stars, saved_at = excluded.saved_at`,
    ).bind(
      String(githubId), item.fullName, item.name || '', item.owner || '', item.url || '',
      item.avatar || '', Number(item.stars) || 0, item.language || '',
      item.description || '', item.descriptionZh || '',
      JSON.stringify(Array.isArray(item.topics) ? item.topics.slice(0, 5) : []),
      item.savedAt || new Date().toISOString(),
    ).run();
    return listFavorites(githubId);
  }

  async function removeFavorite(githubId, fullName) {
    await db.prepare('DELETE FROM favorites WHERE github_id = ? AND full_name = ?')
      .bind(String(githubId), String(fullName)).run();
    return listFavorites(githubId);
  }

  async function countFavorites(githubId) {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE github_id = ?')
      .bind(String(githubId)).first();
    return Number(row && row.n) || 0;
  }

  return {
    kind: 'd1',
    listFavorites,
    getUserByGithubId,
    getUserByLogin,
    upsertProfile,
    updateUser,
    addFavorite,
    removeFavorite,
    countFavorites,
  };
}

/* ---------- KV 兜底实现（未绑定 D1 时使用） ---------- */

// 这里自带一份随机令牌实现，避免与 auth.js 形成循环依赖
function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createKvStore(kv) {
  const kUser = (id) => `user:v1:${id}`;
  const kLogin = (login) => `login:v1:${String(login || '').toLowerCase()}`;
  const kSession = (token) => `session:v1:${token}`;
  const USER_TTL = 60 * 60 * 24 * 365;
  const SESSION_TTL = 60 * 60 * 24 * 30;

  async function readUser(githubId) {
    try {
      const raw = await kv.get(kUser(githubId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function writeUser(user) {
    try {
      await kv.put(kUser(user.githubId), JSON.stringify(user), { expirationTtl: USER_TTL });
      await kv.put(kLogin(user.login), String(user.githubId), { expirationTtl: USER_TTL });
      return true;
    } catch {
      return false;
    }
  }

  return {
    kind: 'kv',

    async listFavorites(githubId) {
      const user = await readUser(githubId);
      return (user && Array.isArray(user.favoriteItems)) ? user.favoriteItems : [];
    },

    getUserByGithubId: readUser,

    async getUserByLogin(login) {
      try {
        const id = await kv.get(kLogin(login));
        return id ? readUser(id) : null;
      } catch {
        return null;
      }
    },

    async upsertProfile(profile) {
      const existing = await readUser(profile.githubId);
      const user = {
        githubId: String(profile.githubId),
        login: profile.login || '',
        name: profile.name || profile.login || '',
        avatar: profile.avatar || '',
        htmlUrl: profile.htmlUrl || '',
        createdAt: (existing && existing.createdAt) || new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        publicProfile: (existing && existing.publicProfile) !== false,
        favorites: (existing && Array.isArray(existing.favorites)) ? existing.favorites : [],
        favoriteItems: (existing && Array.isArray(existing.favoriteItems)) ? existing.favoriteItems : [],
        bilibili: (existing && existing.bilibili) || null,
      };
      return (await writeUser(user)) ? user : null;
    },

    async updateUser(user) {
      return writeUser(user);
    },

    async addFavorite(githubId, item) {
      const user = (await readUser(githubId))
        || { githubId: String(githubId), favorites: [], favoriteItems: [] };
      const items = (Array.isArray(user.favoriteItems) ? user.favoriteItems : [])
        .filter((i) => i.fullName !== item.fullName);
      items.unshift(item);
      user.favoriteItems = items.slice(0, MAX_FAVORITES);
      user.favorites = user.favoriteItems.map((i) => i.fullName);
      await writeUser(user);
      return user.favoriteItems;
    },

    async removeFavorite(githubId, fullName) {
      const user = await readUser(githubId);
      if (!user) return [];
      user.favoriteItems = (user.favoriteItems || []).filter((i) => i.fullName !== fullName);
      user.favorites = user.favoriteItems.map((i) => i.fullName);
      await writeUser(user);
      return user.favoriteItems;
    },

    async countFavorites(githubId) {
      const user = await readUser(githubId);
      return (user && Array.isArray(user.favorites)) ? user.favorites.length : 0;
    },

    /* 旧 KV 会话：兼容本次改动前签发的 Cookie */
    async getSession(token) {
      try {
        return await kv.get(kSession(token));
      } catch {
        return null;
      }
    },

    async createSession(githubId) {
      const token = randomToken(32);
      try {
        await kv.put(kSession(token), String(githubId), { expirationTtl: SESSION_TTL });
        return token;
      } catch {
        return null;
      }
    },

    async deleteSession(token) {
      try {
        await kv.delete(kSession(token));
      } catch {
        /* ignore */
      }
    },
  };
}

/** 优先 D1，其次 KV；两者都没有时返回 null */
export function createUserStore(env = {}) {
  if (env.USER_DB && typeof env.USER_DB.prepare === 'function') return createD1Store(env.USER_DB);
  if (env.TRENDING_KV && typeof env.TRENDING_KV.get === 'function') return createKvStore(env.TRENDING_KV);
  return null;
}