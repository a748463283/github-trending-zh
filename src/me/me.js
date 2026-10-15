/**
 * 个人主页 / 收藏页
 *   /me/              查看并管理自己的收藏（需登录）
 *   /me/?u=<login>    查看他人的公开收藏页（只读）
 *
 * 收藏列表用的是「收藏那一刻的项目快照」（存在 KV），
 * 所以这里完全不请求 GitHub 接口，不受限流影响。
 */

const state = {
  mode: 'self',
  authConfigured: false,
  me: null,
  profile: null,
  favorites: [],
  query: '',
  sort: 'saved',
};

const el = {
  pageTitle: document.getElementById('page-title'),
  pageSubtitle: document.getElementById('page-subtitle'),
  authSlot: document.getElementById('auth-slot'),
  notice: document.getElementById('notice-slot'),
  profileSlot: document.getElementById('profile-slot'),
  favSection: document.getElementById('favorites-section'),
  favTitle: document.getElementById('fav-title'),
  favCount: document.getElementById('fav-count'),
  favGrid: document.getElementById('fav-grid'),
  favQuery: document.getElementById('fav-q'),
  favSort: document.getElementById('fav-sort'),
  toast: document.getElementById('toast'),
  footerHint: document.getElementById('footer-hint'),
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

let toastTimer = 0;
function toast(message, kind = '') {
  el.toast.textContent = message;
  el.toast.dataset.kind = kind;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4600);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回的不是 JSON（HTTP ${res.status}）`);
  }
}

async function postMe(payload) {
  try {
    const res = await fetch('../api/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) {
      toast(json.error || '操作失败', 'error');
      return null;
    }
    state.me = json.user;
    state.profile = json.user;
    state.favorites = (json.user && json.user.favoriteItems) || [];
    return json.user;
  } catch (err) {
    toast(`操作失败：${err.message}`, 'error');
    return null;
  }
}

function targetLogin() {
  const params = new URLSearchParams(location.search);
  return (params.get('u') || params.get('login') || '').trim();
}

function showNotice(kind, title, body) {
  el.notice.innerHTML = `<div class="notice" data-kind="${kind}">
    <span aria-hidden="true">${kind === 'error' ? '⚠️' : 'ℹ️'}</span>
    <div><strong>${escapeHtml(title)}</strong> ${body}</div>
  </div>`;
}

function renderAuth() {
  if (state.mode === 'public') {
    el.authSlot.innerHTML = '<a class="icon-button" href="../">浏览榜单</a>';
    return;
  }
  if (!state.me) {
    el.authSlot.innerHTML = state.authConfigured
      ? '<a class="auth-login" href="../api/auth/login">用 GitHub 登录</a>'
      : '<button class="auth-login auth-login--warn" type="button" data-act="explain">GitHub 登录（待配置）</button>';
    return;
  }
  const u = state.me;
  el.authSlot.innerHTML = `<span class="auth-user" style="cursor:default">
    ${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" width="26" height="26">` : ''}
    <span class="auth-name">${escapeHtml(u.name)}</span>
  </span>`;
}

function renderProfile() {
  const p = state.profile;
  if (!p) return;

  const bili = p.bilibili;
  const biliText = !bili ? '未关联' : (bili.verified ? `已验证 · ${bili.label || bili.mid}` : `待验证 · ${bili.mid}`);
  const isSelf = state.mode === 'self';
  const shareUrl = `${location.origin}/me/?u=${encodeURIComponent(p.login)}`;

  el.profileSlot.hidden = false;
  el.profileSlot.innerHTML = `<div class="profile-card">
    ${p.avatar
    ? `<img class="profile-avatar" src="${escapeHtml(p.avatar)}" alt="" width="64" height="64">`
    : '<span class="profile-avatar" aria-hidden="true"></span>'}
    <div class="profile-main">
      <h2>${escapeHtml(p.name || p.login)}${isSelf ? '' : ' 的公开收藏页'}</h2>
      <p class="login">
        <a href="${escapeHtml(p.htmlUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(p.login)}</a>
        ${isSelf ? ` · 本站账号创建于 ${escapeHtml(formatDate(p.createdAt))}` : ''}
        ${bili ? ` · <a href="${escapeHtml(bili.spaceUrl)}" target="_blank" rel="noopener noreferrer">B 站主页</a>` : ''}
      </p>
      <div class="profile-stats">
        <span>收藏 <strong>${state.favorites.length}</strong> 个</span>
        <span>B 站 <strong>${escapeHtml(biliText)}</strong></span>
        ${isSelf ? `<span>公开收藏页 <strong>${p.publicProfile === false ? '已关闭' : '已开启'}</strong></span>` : ''}
      </div>
    </div>
    <div class="profile-actions">
      <button class="icon-button" type="button" data-act="copy-link" data-url="${escapeHtml(shareUrl)}">复制分享链接</button>
      ${isSelf ? `<button class="icon-button" type="button" data-act="toggle-visibility">
        ${p.publicProfile === false ? '设为公开' : '设为不公开'}</button>` : ''}
      ${isSelf ? '<a class="icon-button" href="../api/auth/logout">退出登录</a>' : ''}
    </div>
  </div>`;
}

/* ---------- 收藏列表 ---------- */

function matches(item, q) {
  if (!q) return true;
  const hay = [
    item.name, item.owner, item.fullName, item.description, item.descriptionZh, item.language,
    ...(item.topics || []).flatMap((t) => [t.key, t.zh]),
  ].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((kw) => hay.includes(kw));
}

function sortedFavorites() {
  const list = state.favorites.filter((i) => matches(i, state.query)).slice();
  if (state.sort === 'star') list.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  else if (state.sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  else list.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  return list;
}

function favCard(item) {
  const zh = item.descriptionZh && item.descriptionZh !== item.description ? item.descriptionZh : '';
  const tags = (item.topics || []).slice(0, 5)
    .map((t) => `<li class="tag">${escapeHtml(t.zh || t.key)}</li>`).join('');
  const biliSearch = 'https://search.bilibili.com/all?keyword='
    + encodeURIComponent(`${item.name} 安装教程`);

  return `<article class="fav-card">
    <div class="card-top">
      ${item.avatar
    ? `<img class="card-avatar" src="${escapeHtml(item.avatar)}" alt="" loading="lazy" width="34" height="34">`
    : '<span class="card-avatar" aria-hidden="true"></span>'}
      <div class="card-title">
        <h3>
          <span class="card-owner">${escapeHtml(item.owner)} /</span>
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>
        </h3>
      </div>
      ${state.mode === 'self'
    ? `<button class="fav-remove" type="button" data-remove="${escapeHtml(item.fullName)}"
         aria-label="移除 ${escapeHtml(item.name)}">移除</button>` : ''}
    </div>
    ${zh
    ? `<p class="desc-zh">${escapeHtml(zh)}</p>`
    : `<p class="desc-zh" lang="en">${escapeHtml(item.description || '（作者未填写项目描述）')}</p>`}
    ${tags ? `<ul class="tag-row">${tags}</ul>` : ''}
    <div class="meta-row">
      <span style="color:var(--star);font-weight:600">★ ${escapeHtml(formatCount(item.stars))}</span>
      ${item.language ? `<span>${escapeHtml(item.language)}</span>` : ''}
      <span>收藏于 ${escapeHtml(formatDate(item.savedAt))}</span>
      <a href="${escapeHtml(biliSearch)}" target="_blank" rel="noopener noreferrer">B 站教程</a>
    </div>
  </article>`;
}

function renderFavorites() {
  const list = sortedFavorites();
  el.favCount.textContent = `${list.length} 个`;

  if (!list.length) {
    const empty = state.favorites.length
      ? '没有符合筛选条件的收藏。'
      : (state.mode === 'self'
        ? '还没有收藏 —— 回到榜单，点卡片右上角的 ☆ 就能收藏。'
        : '这位用户还没有公开的收藏。');
    el.favGrid.innerHTML = `<div class="notice" style="grid-column:1/-1">${empty}</div>`;
    return;
  }
  el.favGrid.innerHTML = list.map(favCard).join('');
}

/* ---------- 事件与初始化 ---------- */

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function bindEvents() {
  el.favQuery.addEventListener('input', debounce(() => {
    state.query = el.favQuery.value.trim();
    renderFavorites();
  }, 200));

  el.favSort.addEventListener('change', () => {
    state.sort = el.favSort.value;
    renderFavorites();
  });

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="explain"]')) {
      toast('尚未配置 GitHub 登录：在 Cloudflare Pages 环境变量里添加 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET', 'error');
      return;
    }

    const copyBtn = e.target.closest('[data-act="copy-link"]');
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.url);
        toast('分享链接已复制');
      } catch {
        toast(`请手动复制：${copyBtn.dataset.url}`);
      }
      return;
    }

    if (e.target.closest('[data-act="toggle-visibility"]')) {
      const next = !(state.profile && state.profile.publicProfile !== false);
      const user = await postMe({ action: 'set-visibility', public: next });
      if (user) {
        toast(next ? '已开启公开收藏页' : '已关闭，别人访问会提示未公开');
        renderAuth();
        renderProfile();
      }
      return;
    }

    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const fullName = removeBtn.dataset.remove;
      const user = await postMe({ action: 'unfavorite', fullName });
      if (user) {
        toast(`已移除 ${fullName}`);
        renderProfile();
        renderFavorites();
      }
    }
  });
}

async function loadPublicProfile(login) {
  state.mode = 'public';
  document.title = `@${login} 的收藏 · GitHub 热门项目中文榜`;
  el.pageTitle.textContent = `@${login} 的收藏`;
  el.pageSubtitle.textContent = '公开收藏页';

  try {
    const json = await fetchJson(`../api/profile?u=${encodeURIComponent(login)}`);
    if (!json.ok) {
      showNotice('error', '打不开这个主页', escapeHtml(json.error || ''));
      el.favSection.hidden = true;
      renderAuth();
      return;
    }
    state.profile = json.profile;
    state.favorites = json.profile.favorites || [];
    el.favTitle.textContent = `${json.profile.login} 的收藏`;
    el.footerHint.textContent = '这是公开收藏页：展示的是收藏那一刻的项目快照，点项目名可查看最新数据。';
    renderAuth();
    renderProfile();
    renderFavorites();
  } catch (err) {
    showNotice('error', '加载失败', escapeHtml(err.message));
    el.favSection.hidden = true;
  }
}

async function loadSelf() {
  try {
    const me = await fetchJson('../api/me');
    state.authConfigured = Boolean(me.configured);
    state.me = me.user;

    if (me.user) {
      state.profile = me.user;
      state.favorites = me.user.favoriteItems || [];
      renderAuth();
      renderProfile();
      renderFavorites();
      return;
    }

    showNotice('warn', '还没有登录', state.authConfigured
      ? '登录后即可在这里管理收藏，并得到一个可分享的公开收藏页。'
      : '站点尚未配置 GitHub 登录（需要 <code>GITHUB_CLIENT_ID</code> / <code>GITHUB_CLIENT_SECRET</code>），配置后即可使用收藏与个人主页。');
    el.favSection.hidden = true;
    renderAuth();
  } catch (err) {
    showNotice('error', '加载失败', escapeHtml(err.message));
    el.favSection.hidden = true;
  }
}

function init() {
  bindEvents();
  const login = targetLogin();
  if (login) loadPublicProfile(login);
  else loadSelf();
}

init();
