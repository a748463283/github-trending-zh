/**
 * 前端渲染逻辑（原生 ES 模块，无框架）
 *
 * 读取顺序：/api/trending（Pages Functions 实时数据）
 *       -> /data/trending-<周期>.json（构建期静态快照，API 不可用时兜底）
 */

const PERIODS = ['week', 'month', 'year'];
const PERIOD_LABEL = { week: '本周', month: '本月', year: '今年' };
const PREVIEW_COUNT = 6;

const state = {
  period: 'week',
  payload: null,
  source: 'api',
  query: '',
  sort: 'star',
  expandAll: false,
  loading: false,
  merged: { filledTutorials: 0, filledZh: 0 },
  user: null,
  favorites: new Set(),
  authConfigured: false,
  authPanelOpen: false,
  onlyFavorites: false,
};

const el = {
  periodSwitch: document.querySelector('.segmented'),
  themeToggle: document.getElementById('theme-toggle'),
  authSlot: document.getElementById('auth-slot'),
  nav: document.getElementById('cat-nav'),
  notice: document.getElementById('notice-slot'),
  sections: document.getElementById('sections'),
  q: document.getElementById('q'),
  sort: document.getElementById('sort'),
  expandAll: document.getElementById('expand-all'),
  onlyFav: document.getElementById('only-fav'),
  onlyFavWrap: document.getElementById('only-fav-wrap'),
  refresh: document.getElementById('refresh'),
  stat: document.getElementById('stat-line'),
  toast: document.getElementById('toast'),
};

/* ---------- 工具 ---------- */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, '')} 亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8',
  Rust: '#dea584', Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
  Shell: '#89e051', Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF',
  Dart: '#00B4AB', HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Svelte: '#ff3e00',
  Lua: '#000080', Zig: '#ec915c', 'Jupyter Notebook': '#DA5B0B', Dockerfile: '#384d54',
};

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- 主题 ---------- */

function initTheme() {
  const saved = localStorage.getItem('gtz-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  updateThemeLabel();
}

function updateThemeLabel() {
  const isDark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme
      && window.matchMedia('(prefers-color-scheme: dark)').matches);
  el.themeToggle.textContent = isDark ? '☀️ 浅色' : '🌙 深色';
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme
      && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('gtz-theme', next);
  updateThemeLabel();
}

/* ---------- 数据加载 ---------- */

function renderSkeleton() {
  el.sections.innerHTML = `<div class="card-grid">${
    Array.from({ length: 6 }, () => `<div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-line"></div><div class="skeleton-line"></div>
      <div class="skeleton-line"></div><div class="skeleton-line"></div>
    </div>`).join('')}</div>`;
  el.stat.textContent = '正在加载数据…';
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 用构建快照补全实时接口缺失的内容。
 * 为什么需要：Cloudflare 出口 IP 常被 B 站风控（HTTP 412），运行时抓不到教程；
 * 构建期的快照里有真实教程数据，这里按 fullName 对齐后补上，保证线上页面有教程可看。
 */
function mergeSnapshot(apiPayload, snapshot) {
  const index = new Map();
  for (const s of snapshot.sections || []) {
    for (const r of s.repos || []) index.set(r.fullName, r);
  }

  let filledTutorials = 0;
  let filledZh = 0;

  for (const s of apiPayload.sections || []) {
    for (const r of s.repos || []) {
      const snap = index.get(r.fullName);
      if (!snap) continue;

      const hasVideos = r.tutorials && Array.isArray(r.tutorials.videos) && r.tutorials.videos.length;
      const snapVideos = snap.tutorials && Array.isArray(snap.tutorials.videos)
        ? snap.tutorials.videos : [];
      if (!hasVideos && snapVideos.length) {
        r.tutorials = { ...snap.tutorials, source: 'snapshot' };
        filledTutorials += 1;
      }
      if (!r.descriptionZh && snap.descriptionZh) {
        r.descriptionZh = snap.descriptionZh;
        filledZh += 1;
      }
    }
  }
  return { filledTutorials, filledZh };
}

async function loadPeriod(period, { force = false } = {}) {
  state.loading = true;
  state.period = period;
  renderSkeleton();
  syncUrl();

  const snapshotUrl = `data/trending-${period}.json`;
  const snapshotPromise = fetchJson(snapshotUrl).catch(() => null);

  let payload = null;
  let source = 'api';
  let errorText = '';
  let merged = { filledTutorials: 0, filledZh: 0 };

  try {
    const query = `api/trending?period=${period}${force ? '&nocache=1' : ''}`;
    const json = await fetchJson(query);
    if (json && json.ok) {
      payload = json;
    } else {
      errorText = (json && json.error) || '接口返回失败';
    }
  } catch (err) {
    errorText = err.message;
  }

  const snapshot = await snapshotPromise;

  if (payload) {
    if (snapshot && Array.isArray(snapshot.sections) && snapshot.sections.length) {
      merged = mergeSnapshot(payload, snapshot);
    }
  } else if (snapshot && Array.isArray(snapshot.sections) && snapshot.sections.length) {
    payload = snapshot;
    source = 'snapshot';
  }

  state.loading = false;
  state.merged = merged;

  if (!payload) {
    state.payload = null;
    state.source = source;
    el.sections.innerHTML = '';
    renderNotice('error', '数据暂时不可用', `实时接口与静态快照都取不到数据（${escapeHtml(errorText)}）。请稍后重试，或先运行 <code>npm run build</code> 生成静态快照。`);
    el.stat.textContent = '无可显示数据';
    return;
  }

  state.payload = payload;
  state.source = source;
  renderNotice(source, errorText);
  render();
}

/* ---------- 过滤与排序 ---------- */

function matchesQuery(repo, q) {
  if (!q) return true;
  const haystack = [
    repo.name, repo.owner, repo.fullName, repo.description, repo.descriptionZh,
    repo.language, ...(repo.topics || []).flatMap((t) => [t.key, t.zh]),
  ].join(' ').toLowerCase();
  // 空格分隔的关键词需全部命中
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((kw) => haystack.includes(kw));
}

function sortRepos(list, mode) {
  const out = [...list];
  if (mode === 'new') out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  else if (mode === 'fork') out.sort((a, b) => b.forks - a.forks);
  else if (mode === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  else out.sort((a, b) => b.stars - a.stars);
  return out;
}

function visibleSections() {
  if (!state.payload) return [];
  return state.payload.sections
    .map((section) => {
      const repos = sortRepos(
        section.repos.filter((r) => matchesQuery(r, state.query)
          && (!state.onlyFavorites || state.favorites.has(r.fullName))),
        state.sort,
      );
      return { ...section, repos, filtered: repos.length };
    })
    .filter((section) => section.filtered > 0);
}

/* ---------- Star 增长曲线 ---------- */

/**
 * 曲线来源只有两种，且界面会如实标注：
 *   measured  实测点（≥2 个「时间 + Star」采样点，由站点每日采集）
 *   projected 推算线（实测不足时，按「创建至今的日均增速」画虚线）
 */
function trendRow(repo) {
  const curve = repo.curve;
  if (!curve || !Array.isArray(curve.points) || curve.points.length < 2) return '';

  const w = 132;
  const h = 32;
  const pad = 3;
  const pts = curve.points;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1;
  const spanY = (maxY - minY) || 1;

  const coords = pts.map(([x, y]) => [
    pad + ((x - minX) / spanX) * (w - pad * 2),
    h - pad - ((y - minY) / spanY) * (h - pad * 2),
  ]);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${h - pad} L${coords[0][0].toFixed(1)} ${h - pad} Z`;

  const measured = curve.source === 'measured';
  const delta = Number(curve.delta) || 0;
  const sign = delta >= 0 ? '+' : '-';
  let label;
  if (measured) {
    label = `近 ${curve.days} 天 ${sign}${formatCount(Math.abs(delta))} ★（实测 ${pts.length} 个点）`;
  } else if (curve.perDay) {
    label = `日均 +${formatCount(curve.perDay)} ★/天（按创建至今推算，实测曲线累积中）`;
  } else {
    label = '增长曲线累积中';
  }

  return `<div class="trend">
    <svg class="spark${measured ? '' : ' spark--projected'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path class="spark-area" d="${area}"></path>
      <path class="spark-line" d="${line}"></path>
    </svg>
    <span class="trend-label">${escapeHtml(label)}</span>
  </div>`;
}

/* ---------- 卡片渲染 ---------- */

function tutorialHtml(repo) {
  const t = repo.tutorials || {};
  const videos = Array.isArray(t.videos) ? t.videos : [];
  const searchUrl = t.searchUrl
    || `https://search.bilibili.com/all?keyword=${encodeURIComponent(`${repo.name} 安装教程`)}`;

  if (videos.length) {
    const items = videos.map((v) => `<li>
      <a href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v.title)}</a>
      <span class="tut-meta">${escapeHtml(v.author || '未知 UP 主')} · ${escapeHtml(v.playText || formatCount(v.play))} 播放${v.durationText ? ` · ${escapeHtml(v.durationText)}` : ''}</span>
    </li>`).join('');
    return `<div class="tutorials">
      <p class="tutorials-title">📺 哔哩哔哩安装教程 <span class="note">（自动匹配 ${videos.length} 条）</span></p>
      <ul class="tut-list">${items}</ul>
      <p class="tut-empty"><a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer">查看更多 B 站教程 →</a></p>
    </div>`;
  }

  const reason = t.error ? '教程检索暂时失败' : '暂未匹配到相关教程';
  return `<div class="tutorials">
    <p class="tutorials-title">📺 哔哩哔哩安装教程 <span class="note">（${reason}）</span></p>
    <p class="tut-empty"><a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer">去 B 站搜索「${escapeHtml(repo.name)} 安装教程」→</a></p>
  </div>`;
}

function repoCard(repo) {
  const zh = repo.descriptionZh && repo.descriptionZh !== repo.description ? repo.descriptionZh : '';
  const tags = (repo.topics || []).slice(0, 5)
    .map((t) => `<li class="tag">${escapeHtml(t.zh || t.key)}</li>`).join('');
  const dot = LANG_COLORS[repo.language] || 'var(--border-strong)';
  const age = Number.isFinite(repo.ageDays) ? `${repo.ageDays} 天前创建` : '';

  return `<article class="card">
    <div class="card-top">
      ${repo.avatar
    ? `<img class="card-avatar" src="${escapeHtml(repo.avatar)}" alt="" loading="lazy" width="34" height="34">`
    : '<span class="card-avatar" aria-hidden="true"></span>'}
      <div class="card-title">
        <h3>
          <span class="card-owner">${escapeHtml(repo.owner)} /</span>
          <a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo.name)}</a>
        </h3>
      </div>
      <div class="card-metrics">
        <span class="star" title="Star 数">★ ${escapeHtml(repo.starsText || formatCount(repo.stars))}</span>
        <span title="Fork 数">⑂ ${escapeHtml(repo.forksText || formatCount(repo.forks))}</span>
      </div>
      ${favoriteButton(repo)}
    </div>

    ${zh
    ? `<p class="desc-zh">${escapeHtml(zh)}</p>
       <p class="desc-en" lang="en">原文：${escapeHtml(repo.description)}</p>`
    : `<p class="desc-zh" lang="en">${escapeHtml(repo.description || '（作者未填写项目描述）')}</p>`}

    ${tags ? `<ul class="tag-row">${tags}</ul>` : ''}

    <div class="meta-row">
      ${repo.language ? `<span><span class="lang-dot" style="background:${dot}"></span> ${escapeHtml(repo.language)}</span>` : ''}
      ${repo.license ? `<span>${escapeHtml(repo.license)}</span>` : ''}
      ${age ? `<span>${age}</span>` : ''}
      ${repo.homepage ? `<a href="${escapeHtml(repo.homepage)}" target="_blank" rel="noopener noreferrer">官网</a>` : ''}
    </div>

    ${trendRow(repo)}
    ${tutorialHtml(repo)}
  </article>`;
}

/** 收藏按钮：未登录时点击会提示先登录 */
function favoriteButton(repo) {
  const fullName = escapeHtml(repo.fullName);
  const isFav = state.favorites.has(repo.fullName);
  return `<button class="fav-btn" type="button" data-fav="${fullName}"
    aria-pressed="${isFav ? 'true' : 'false'}"
    title="${isFav ? '取消收藏' : '收藏到我的列表'}"
    aria-label="${isFav ? '取消收藏' : '收藏'} ${escapeHtml(repo.name)}">${isFav ? '★' : '☆'}</button>`;
}


function renderNotice(source, errorText) {
  if (source === 'api') {
    el.notice.innerHTML = '';
    return;
  }
  const generated = state.payload && state.payload.generatedAt
    ? formatTime(state.payload.generatedAt) : '未知';
  const reason = errorText ? `实时接口不可用（${escapeHtml(errorText)}）` : '当前为纯静态部署';
  el.notice.innerHTML = `<div class="notice" data-kind="warn">
    <span aria-hidden="true">⏱️</span>
    <div><strong>正在显示静态快照数据。</strong>
    原因：${reason}。快照生成时间：${generated}。
    部署 Cloudflare Pages 并绑定 Pages Functions 后即可自动获取实时数据。</div>
  </div>`;
}

/* ---------- 分区渲染 ---------- */

function sectionHtml(section) {
  const shown = state.expandAll ? section.repos : section.repos.slice(0, PREVIEW_COUNT);
  const hidden = section.repos.length - shown.length;
  const id = escapeHtml(section.id);

  return `<section class="section" id="cat-${id}" aria-labelledby="cat-${id}-title">
    <div class="section-head">
      <span class="emoji" aria-hidden="true">${escapeHtml(section.emoji || '📦')}</span>
      <h2 id="cat-${id}-title">${escapeHtml(section.name)}</h2>
      <p class="desc">${escapeHtml(section.desc || '')}</p>
      <span class="badge">${section.filtered} 个</span>
      ${hidden > 0 ? `<button class="icon-button more" type="button" data-expand="${id}">展开剩余 ${hidden} 个</button>` : ''}
    </div>
    <div class="card-grid">${shown.map(repoCard).join('')}</div>
  </section>`;
}

function render() {
  const sections = visibleSections();
  el.sections.innerHTML = sections.length
    ? sections.map(sectionHtml).join('')
    : '<div class="notice" data-kind="error">没有符合条件的项目，试试更换关键词或恢复默认排序。</div>';
  renderNav(sections);
  renderStat(sections);
  observeSections();
}

function renderNav(sections) {
  el.nav.innerHTML = sections.map((s) => `<a href="#cat-${escapeHtml(s.id)}" data-cat="${escapeHtml(s.id)}">
    <span aria-hidden="true">${escapeHtml(s.emoji || '📦')}</span>
    <span>${escapeHtml(s.name)}</span>
    <span class="nav-count">${s.filtered}</span>
  </a>`).join('');
}

function renderStat(sections) {
  const total = sections.reduce((sum, s) => sum + s.filtered, 0);
  const meta = (state.payload && state.payload.meta) || {};
  const time = state.payload && state.payload.generatedAt ? formatTime(state.payload.generatedAt) : '';
  const periodName = (state.payload && state.payload.periodName) || PERIOD_LABEL[state.period] || '';
  const tr = meta.translation || {};

  let line = `${escapeHtml(periodName)}共 <strong>${total}</strong> 个项目 · ${sections.length} 个分区`
    + ` · 数据时间 ${escapeHtml(time)}`
    + ` · 来源：${state.source === 'api' ? '实时接口' : '静态快照'}`;
  if (tr.translated) line += ` · 本次新增翻译 ${tr.translated} 条`;
  if (tr.pending) line += ` · 待翻译 ${tr.pending} 条`;
  if (meta.cached) line += ' · 命中边缘缓存';
  const filled = (state.merged && (state.merged.filledTutorials + state.merged.filledZh)) || 0;
  if (filled) line += ` · 构建快照补全 ${filled} 项`;
  el.stat.innerHTML = line;
}

/* ---------- 分区高亮（滚动跟随） ---------- */

let observer = null;

function observeSections() {
  if (observer) observer.disconnect();
  if (!('IntersectionObserver' in window)) return;

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id.replace('cat-', '');
      el.nav.querySelectorAll('a').forEach((a) => {
        a.setAttribute('aria-current', a.dataset.cat === id ? 'true' : 'false');
      });
    }
  }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

  el.sections.querySelectorAll('section.section').forEach((s) => observer.observe(s));
}

/* ---------- URL 状态 ---------- */

function syncUrl() {
  const params = new URLSearchParams();
  if (state.period !== 'week') params.set('period', state.period);
  if (state.query) params.set('q', state.query);
  const qs = params.toString();
  const next = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
  history.replaceState(null, '', next);
}

/* ---------- 账号：GitHub 登录 / 关联 B 站 / 收藏 ---------- */

let toastTimer = 0;

function toast(message, kind = '') {
  el.toast.textContent = message;
  el.toast.dataset.kind = kind;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4600);
}

const AUTH_MESSAGES = {
  ok: ['已用 GitHub 登录成功', ''],
  logout: ['已退出登录', ''],
  denied: ['你取消了 GitHub 授权', 'error'],
  not_configured: ['站点尚未配置 GitHub 登录（需要 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）', 'error'],
  kv_missing: ['站点未绑定 KV，无法建立登录会话', 'error'],
  state_mismatch: ['登录状态校验失败，请重新登录', 'error'],
  no_code: ['没有拿到授权码，请重新登录', 'error'],
  exchange_failed: ['换取 GitHub 令牌失败（Client Secret 可能不对或已过期）', 'error'],
  exchange_error: ['连接 GitHub 失败，请重试', 'error'],
  profile_failed: ['读取 GitHub 资料失败', 'error'],
  profile_error: ['连接 GitHub 失败，请重试', 'error'],
  storage_failed: ['登录信息没能保存到 KV（写入失败），本次登录未生效', 'error'],
  ok_degraded: ['已登录；但用户资料没能写入 KV，收藏功能暂不可用', ''],
};

/** 登录失败时的持久提示（toast 只闪几秒，容易让人误以为登录成功了） */
function authNotice(code) {
  const detail = {
    storage_failed: '登录时无法把用户数据写入 KV。Cloudflare KV 免费额度是每天 1000 次写，'
      + '用尽后写入会失败（按 UTC 零点重置，即北京时间早上 8 点）。本次登录没有生效，请稍后重试；'
      + '站点已降低缓存写入频率，之后不会再抢占额度。',
    session_missing: 'GitHub 授权已成功，但站点没有拿到登录会话：常见原因是 KV 写入失败（额度用尽）'
      + '或浏览器拦截了 Cookie。可打开 <a href="api/health?full=1" target="_blank" rel="noopener">'
      + '/api/health?full=1</a> 查看 KV / 会话 / OAuth 三项诊断结果。',
    storage_degraded: '登录已生效（会话走签名 Cookie，不依赖 KV 写入）。但你的用户资料没能写进 KV，'
      + '所以「收藏 / 关联 B 站」暂时不可用。Cloudflare KV 免费额度按 UTC 零点重置（北京时间早上 8 点），'
      + '重置后重新登录即可正常使用。',
  }[code];
  if (!detail) return '';
  return `<div class="notice" data-kind="error">
    <span aria-hidden="true">⚠️</span>
    <div><strong>登录未完成。</strong> ${detail}</div>
  </div>`;
}

async function loadMe() {
  try {
    const res = await fetch('api/me', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.authConfigured = Boolean(json.configured);
    state.user = json.user || null;
    state.favorites = new Set((state.user && state.user.favorites) || []);
  } catch {
    // 纯静态部署（没有 Pages Functions）时走这里：不显示登录入口，站点功能不受影响
    state.authConfigured = false;
    state.user = null;
    state.favorites = new Set();
  }
  if (!state.user) {
    state.onlyFavorites = false;
    el.onlyFav.checked = false;
  }
  el.onlyFavWrap.hidden = !state.user;
  renderAuth();
}

function biliPanelBody(bili) {
  if (bili && bili.mid && bili.verified) {
    return `<p class="hint">已关联 B 站：<a href="${escapeHtml(bili.spaceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bili.label || bili.mid)}</a></p>
      <div class="row">
        <button class="icon-button" type="button" data-act="verify">重新校验</button>
        <button class="icon-button" type="button" data-act="unbind">解除关联</button>
      </div>`;
  }

  const code = (bili && bili.code) || '';
  const mid = (bili && bili.mid) || '';

  if (!code) {
    return `<p class="hint">用「把验证码写进 B 站个人签名」的方式完成关联，不需要 B 站开放平台审核。</p>
      <div class="row"><button class="icon-button" type="button" data-act="get-code">获取验证码</button></div>`;
  }

  return `<p class="hint">1. 打开 B 站「个人中心 → 编辑资料 → 签名」，写入下面这串验证码并保存：</p>
    <div class="row"><code>${escapeHtml(code)}</code>
      <button class="icon-button" type="button" data-act="copy">复制</button></div>
    <p class="hint">2. 填入你的 B 站 UID（个人空间地址里的数字）后点验证：</p>
    <div class="row">
      <input type="text" id="bili-mid" inputmode="numeric" placeholder="例如 12345678" value="${escapeHtml(mid)}">
      <button class="icon-button" type="button" data-act="bind">验证并保存</button>
    </div>
    ${bili && bili.reason ? `<p class="hint">上次校验：${escapeHtml(bili.reason)}</p>` : ''}
    <p class="hint">说明：B 站接口对本站服务器经常返回 412 风控，此时会先记录绑定并标为「待验证」，
      填好签名后回来点「重新校验」即可。</p>
    ${mid ? '<div class="row"><button class="icon-button" type="button" data-act="unbind">解除关联</button></div>' : ''}`;
}

function renderAuth() {
  const u = state.user;

  if (!u) {
    el.onlyFavWrap.hidden = true;
    el.authSlot.innerHTML = state.authConfigured
      ? '<a class="auth-login" href="api/auth/login">用 GitHub 登录</a>'
      : '<button class="auth-login auth-login--warn" type="button" data-auth="explain">GitHub 登录（待配置）</button>';
    return;
  }

  const bili = u.bilibili || null;
  const badgeText = !bili || !bili.mid ? '未关联' : (bili.verified ? '已验证' : '待验证');
  const badgeKind = !bili || !bili.mid ? '' : (bili.verified ? 'ok' : 'pending');

  el.authSlot.innerHTML = `
    <button class="auth-user" type="button" id="auth-toggle" aria-expanded="${state.authPanelOpen}" aria-haspopup="dialog">
      ${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" width="26" height="26" loading="lazy">` : ''}
      <span class="auth-name">${escapeHtml(u.name)}</span>
    </button>
    ${state.authPanelOpen ? `<div class="auth-panel" role="dialog" aria-label="账号面板">
      <h2>${escapeHtml(u.name)}</h2>
      <p class="hint">GitHub：<a href="${escapeHtml(u.htmlUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(u.login)}</a>
        · 已收藏 ${state.favorites.size} 个</p>
      <div class="sep">
        <p class="hint">B 站关联 <span class="state-badge" data-state="${badgeKind}">${badgeText}</span></p>
        ${biliPanelBody(bili)}
      </div>
      <div class="row">
        <a class="icon-button" href="me/">我的收藏页</a>
        <a class="icon-button" href="api/auth/logout">退出登录</a>
      </div>
    </div>` : ''}`;
}

async function postMe(payload) {
  try {
    const res = await fetch('api/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) {
      toast(json.error || '操作失败', 'error');
      return null;
    }
    state.user = json.user;
    state.favorites = new Set((json.user && json.user.favorites) || []);
    return json.user;
  } catch (err) {
    toast(`操作失败：${err.message}`, 'error');
    return null;
  }
}

async function toggleFavorite(fullName) {
  if (!state.user) {
    toast('请先用 GitHub 登录，登录后收藏会保存到你的账号');
    return;
  }
  const isFav = state.favorites.has(fullName);
  const repo = findRepo(fullName);

  const payload = { action: isFav ? 'unfavorite' : 'favorite', fullName };
  // 收藏时把项目快照一起提交，个人主页因此不必再请求 GitHub 接口
  if (!isFav && repo) payload.item = compactItem(repo);

  const user = await postMe(payload);
  if (!user) return;
  toast(isFav ? '已取消收藏' : '已收藏，可在「我的收藏页」查看');
  renderAuth();
  render();
}

/** 在当前数据里找项目（收藏时要提交快照） */
function findRepo(fullName) {
  if (!state.payload) return null;
  for (const section of state.payload.sections) {
    const hit = section.repos.find((r) => r.fullName === fullName);
    if (hit) return hit;
  }
  return null;
}

function compactItem(repo) {
  return {
    fullName: repo.fullName,
    name: repo.name,
    owner: repo.owner,
    url: repo.url,
    avatar: repo.avatar,
    stars: repo.stars,
    language: repo.language,
    description: repo.description,
    descriptionZh: repo.descriptionZh,
    topics: (repo.topics || []).slice(0, 5),
  };
}

/* ---------- 事件与初始化 ---------- */

function setPeriod(period, force) {
  if (!PERIODS.includes(period) || (period === state.period && !force)) return Promise.resolve();
  el.periodSwitch.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.period === period));
  });
  return loadPeriod(period, { force });
}

function bindEvents() {
  el.periodSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-period]');
    if (btn) setPeriod(btn.dataset.period);
  });

  el.themeToggle.addEventListener('click', toggleTheme);

  el.q.addEventListener('input', debounce(() => {
    state.query = el.q.value.trim();
    syncUrl();
    render();
  }, 200));

  el.sort.addEventListener('change', () => {
    state.sort = el.sort.value;
    render();
  });

  el.expandAll.addEventListener('change', () => {
    state.expandAll = el.expandAll.checked;
    render();
  });

  el.refresh.addEventListener('click', () => setPeriod(state.period, true));

  el.sections.addEventListener('click', (e) => {
    const fav = e.target.closest('button[data-fav]');
    if (fav) {
      toggleFavorite(fav.dataset.fav);
      return;
    }

    const btn = e.target.closest('button[data-expand]');
    if (!btn) return;
    state.expandAll = true;
    el.expandAll.checked = true;
    render();
    document.getElementById(`cat-${btn.dataset.expand}`)?.scrollIntoView({ block: 'start' });
  });

  el.onlyFav.addEventListener('change', () => {
    state.onlyFavorites = el.onlyFav.checked;
    render();
  });

  el.authSlot.addEventListener('click', async (e) => {
    if (e.target.closest('#auth-toggle')) {
      state.authPanelOpen = !state.authPanelOpen;
      renderAuth();
      return;
    }

    if (e.target.closest('[data-auth="explain"]')) {
      toast('尚未配置 GitHub 登录：在 Cloudflare Pages 环境变量中添加 GITHUB_CLIENT_ID 与 GITHUB_CLIENT_SECRET，'
        + 'OAuth App 的回调地址填 /api/auth/callback', 'error');
      return;
    }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    const kind = act.dataset.act;

    if (kind === 'get-code') {
      const user = await postMe({ action: 'bilibili-code' });
      if (user) toast('验证码已生成，请填到 B 站个人签名中再回来验证');
      return;
    }

    if (kind === 'copy') {
      const code = (state.user && state.user.bilibili && state.user.bilibili.code) || '';
      try {
        await navigator.clipboard.writeText(code);
        toast('验证码已复制');
      } catch {
        toast(`请手动复制验证码：${code}`);
      }
      return;
    }

    if (kind === 'bind' || kind === 'verify') {
      const input = el.authSlot.querySelector('#bili-mid');
      const mid = input ? input.value.trim() : '';
      if (kind === 'bind' && !/^\d{2,12}$/.test(mid)) {
        toast('请填写 B 站数字 UID（个人空间地址里的那串数字）', 'error');
        return;
      }
      const user = await postMe({ action: kind === 'bind' ? 'bind-bilibili' : 'verify-bilibili', mid });
      if (user && user.bilibili) {
        toast(user.bilibili.verified
          ? `B 站关联成功：${user.bilibili.label || user.bilibili.mid}`
          : `已记录关联，状态「待验证」（${user.bilibili.reason || '等待校验'}）`);
      }
      return;
    }

    if (kind === 'unbind') {
      const user = await postMe({ action: 'unbind-bilibili' });
      if (user) toast('已解除 B 站关联');
    }
  });

  // 点击面板外任意位置时收起面板
  document.addEventListener('click', (e) => {
    if (!state.authPanelOpen) return;
    if (!el.authSlot.contains(e.target)) {
      state.authPanelOpen = false;
      renderAuth();
    }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeLabel);
}

async function init() {
  initTheme();
  bindEvents();

  const params = new URLSearchParams(location.search);
  const period = params.get('period');
  const q = params.get('q');
  if (q) {
    state.query = q;
    el.q.value = q;
  }

  const authParam = params.get('auth');
  if (authParam && AUTH_MESSAGES[authParam]) {
    const [msg, kind] = AUTH_MESSAGES[authParam];
    toast(msg, kind);
    params.delete('auth');
    const qs = params.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  }

  await loadMe();
  await setPeriod(PERIODS.includes(period) ? period : 'week', true);

  // 数据渲染完成后再追加登录相关的持久提示（否则会被 renderNotice 覆盖）
  if (authParam) {
    const kind = AUTH_MESSAGES[authParam] ? AUTH_MESSAGES[authParam][1] : '';
    if (kind === 'error') {
      el.notice.insertAdjacentHTML('beforeend', authNotice(authParam));
    } else if (authParam === 'ok_degraded') {
      el.notice.insertAdjacentHTML('beforeend', authNotice('storage_degraded'));
    } else if (authParam === 'ok' && !state.user) {
      // 「授权成功但没有会话」这种假登录必须显式提示，不能只闪个 toast
      el.notice.insertAdjacentHTML('beforeend', authNotice('session_missing'));
    }
  }
}

init();

