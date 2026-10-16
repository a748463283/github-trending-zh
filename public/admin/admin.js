/**
 * 管理后台 /admin/
 *   仅 ADMIN_LOGINS 里配置的 GitHub 账号可进入；数据来自 /api/admin/users。
 */

const state = { limit: 50, offset: 0, total: 0, me: null, users: [] };

const el = {
  authSlot: document.getElementById('auth-slot'),
  notice: document.getElementById('notice-slot'),
  stats: document.getElementById('stats'),
  usersSection: document.getElementById('users-section'),
  userCount: document.getElementById('user-count'),
  userList: document.getElementById('user-list'),
  pager: document.getElementById('pager'),
  prev: document.getElementById('prev-page'),
  next: document.getElementById('next-page'),
  pageInfo: document.getElementById('page-info'),
};

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, '')} 亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function showNotice(kind, title, body) {
  el.notice.innerHTML = `<div class="notice" data-kind="${kind}">
    <span aria-hidden="true">${kind === 'error' ? '⚠️' : 'ℹ️'}</span>
    <div><strong>${escapeHtml(title)}</strong> ${body}</div>
  </div>`;
}

function renderAuth() {
  if (!state.me) {
    el.authSlot.innerHTML = '<a class="auth-login" href="../api/auth/login">用 GitHub 登录</a>';
    return;
  }
  el.authSlot.innerHTML = `<span class="auth-user" style="cursor:default">
    ${state.me.avatar ? `<img src="${escapeHtml(state.me.avatar)}" alt="" width="26" height="26">` : ''}
    <span class="auth-name">${escapeHtml(state.me.name || state.me.login)}</span>
  </span>`;
}

function userCard(u) {
  const bili = u.bilibili;
  const biliText = !bili
    ? '<span>B 站：未关联</span>'
    : (bili.verified
      ? `<span>B 站：已验证 · <a href="${escapeHtml(bili.spaceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bili.label || bili.mid)}</a>（UID ${escapeHtml(bili.mid)}）</span>`
      : `<span>B 站：待验证 · UID ${escapeHtml(bili.mid)}${bili.reason ? `（${escapeHtml(bili.reason)}）` : ''}</span>`);
  const favs = Array.isArray(u.favorites) ? u.favorites : [];

  return `<article class="admin-user">
    <div class="admin-user-head">
      ${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" width="40" height="40">` : ''}
      <div>
        <strong><a href="${escapeHtml(u.htmlUrl || `https://github.com/${u.login}`)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(u.login)}</a></strong>
        ${u.name && u.name !== u.login ? `<span style="color:var(--muted)"> ${escapeHtml(u.name)}</span>` : ''}
        <a href="../me/?u=${encodeURIComponent(u.login)}" target="_blank" rel="noopener noreferrer">（公开主页）</a>
      </div>
    </div>
    <div class="admin-meta">
      <span>注册 ${escapeHtml(formatDate(u.createdAt))}</span>
      <span>最近登录 ${escapeHtml(formatDate(u.lastLoginAt))}</span>
      <span>${u.publicProfile === false ? '🔒 主页未公开' : '🌐 主页公开'}</span>
      ${biliText}
      <span>收藏 ${favs.length} 个</span>
    </div>
    ${favs.length ? `<div class="admin-favs">${favs.map((f) => `
      <div class="admin-fav">
        <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.fullName)}</a>
        <span>★ ${escapeHtml(formatCount(f.stars))}</span>
        ${f.descriptionZh ? `<span class="zh">${escapeHtml(f.descriptionZh)}</span>` : `<span class="zh" lang="en">${escapeHtml(f.description || '')}</span>`}
        <span style="margin-left:auto;color:var(--muted)">${escapeHtml(formatDate(f.savedAt))}</span>
      </div>`).join('')}</div>` : ''}
  </article>`;
}

function render() {
  el.userCount.textContent = `${state.total} 个`;
  el.stats.hidden = false;
  el.usersSection.hidden = false;
  el.stats.innerHTML = `<div class="admin-stat">用户总数 <strong>${state.total}</strong></div>
    <div class="admin-stat">本页 <strong>${state.users.length}</strong></div>`;
  el.userList.innerHTML = state.users.length
    ? state.users.map(userCard).join('')
    : '<div class="notice">还没有用户登录过本站。</div>';

  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  const page = Math.floor(state.offset / state.limit) + 1;
  el.prev.disabled = state.offset <= 0;
  el.next.disabled = state.offset + state.limit >= state.total;
  el.pageInfo.textContent = `第 ${page} / ${pages} 页`;
  el.pager.hidden = state.total <= state.limit;
}

async function load() {
  try {
    const res = await fetch(`../api/admin/users?limit=${state.limit}&offset=${state.offset}`, {
      headers: { accept: 'application/json' },
    });
    const json = await res.json();
    if (!json.ok) {
      if (json.forbidden) {
        showNotice('error', '没有管理员权限',
          '你的 GitHub 账号不在 ADMIN_LOGINS 里。请在 Cloudflare Pages → Settings → Environment variables 添加 <code>ADMIN_LOGINS</code>（逗号分隔的 GitHub 用户名），然后重新部署。');
      } else if (json.needLogin) {
        showNotice('warn', '请先登录', '用管理员账号登录后即可查看。');
        renderAuth();
      } else if (json.unsupported) {
        showNotice('error', '存储不支持', escapeHtml(json.error || ''));
      } else {
        showNotice('error', '加载失败', escapeHtml(json.error || ''));
      }
      return;
    }
    state.total = json.total || 0;
    state.users = json.users || [];
    state.me = json.admin || { login: '', avatar: '', name: '' };
    renderAuth();
    render();
  } catch (err) {
    showNotice('error', '加载失败', escapeHtml(err.message));
  }
}

el.prev.addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  load();
});
el.next.addEventListener('click', () => {
  state.offset += state.limit;
  load();
});

load();