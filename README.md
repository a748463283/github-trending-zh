# GitHub 热门项目中文榜（周 / 月 / 年 + 分区 + 哔哩哔哩安装教程）

一个部署在 **Cloudflare Pages** 上的中文榜单站：自动抓取 GitHub 本周 / 本月 / 今年最热门的开源项目，
按 **3D 打印、AI 插件、AI 大模型、自托管、开发工具** 等 16 个分区整理，自动翻译为中文，
并为每个项目匹配 **哔哩哔哩安装教程**（真实视频：标题 / UP 主 / 播放量 / 时长）。

## 功能一览

| 功能 | 说明 |
| --- | --- |
| 周 / 月 / 年榜 | 顶部切换，口径为「统计周期内**新建**、按 Star 数排序」，见下文「数据口径」 |
| 16 个分区 | topics + 关键词 + 语言的加权打分自动分类，规则在 `shared/categories.js` |
| 中文翻译 | Cloudflare Workers AI（`@cf/meta/m2m100-1.2b`）；构建期用 REST 批量翻译（**300 个仓库描述已全部译完**），运行时按 KV 缓存 → AI → 术语表降级 |
| B 站教程 | 自研 WBI 签名调用 B 站搜索（**匿名可用**），按「项目名 + 教程词」硬性过滤，只推真正相关的教程 |
| Star 增长曲线 | 自采「时间 + Star」采样点画实测曲线；采样不足时按日均增速画**虚线推算**并明确标注，绝不伪装成实测数据 |
| GitHub 登录 | OAuth 登录 + 会话 Cookie（HttpOnly/Secure/SameSite），登录后可收藏项目、只看收藏 |
| 收藏页 / 个人主页 | `/me/` 管理自己的收藏，`/me/?u=<用户名>` 是可分享的公开收藏页；可一键关闭公开 |
| 关联 B 站 | 「验证码写入 B 站个人签名」方式绑定 UID，服务端尽力自动校验，不可达时如实标为「待验证」 |
| 兜底链路 | 教程检索失败 → B 站搜索链接；接口失败 → 静态快照；快照与接口互为补全，页面不空 |
| 交互 | 关键词搜索、四种排序、分区折叠、深浅色主题、分区滚动跟随、URL 可分享 |
| 自动化 | GitHub Actions 每天定时重建快照、灌 KV 并部署；缓存提交回仓库，增量累积 |

## 架构

```
浏览器
  └─ Cloudflare Pages（静态前端 public/）
        ├─ GET /api/trending?period=week|month|year   ← Pages Functions（functions/api/trending.js）
        │     ├─ KV 聚合缓存（30 分钟）
        │     ├─ GitHub Search API（官方接口）
        │     ├─ Workers AI 翻译 + KV 翻译缓存
        │     └─ B 站 WBI 搜索 + KV 教程缓存
        └─ 接口不可用 → /data/trending-<周期>.json（构建期静态快照）
```

- **shared/**：前端、Functions、构建脚本共用的零依赖 ESM 模块（分类、抓取、翻译、B 站、输出组装）。
- **functions/**：Cloudflare Pages Functions，负责实时数据与缓存。
- **src/**：前端源码（原生 HTML/CSS/JS，无框架、无构建工具）。
- **scripts/**：构建、翻译、自测、本地预览、B 站探针脚本。
- **cache/**：翻译缓存、教程缓存、GitHub 原始数据缓存（提交到仓库，用于增量更新与离线构建）。

## 目录结构

```
github-trending-zh/
├─ functions/api/trending.js    # 主接口（GitHub + 翻译 + B站教程 + Star 曲线 + KV 缓存）
├─ functions/api/health.js      # 自检接口：绑定状态 / 上游连通性 / MD5 自测
├─ functions/api/me.js          # 当前用户：资料 / 收藏 / 关联 B 站
├─ functions/api/profile.js     # 公开个人主页数据（?u=<登录名>）
├─ functions/api/auth/          # GitHub OAuth：login / callback / logout
├─ migrations/0001_init.sql     # D1 表结构（users / favorites）
├─ shared/
│  ├─ categories.js             # 16 个分区规则（加权打分）
│  ├─ github.js                 # GitHub Search API 抓取与归一化
│  ├─ bilibili.js               # WBI 签名 + 教程检索 + 相关度打分
│  ├─ translate.js              # 运行时翻译（KV 缓存 → Workers AI → 术语表）
│  ├─ star-history.js           # Star 曲线：采样、读取、实测/推算两种来源
│  ├─ auth.js                   # 登录会话、Cookie、签名、同源校验、用户视图
│  ├─ user-store.js             # 用户数据存储抽象（D1 优先，KV 兜底）
│  ├─ topics-zh.js              # 常见 topics 中英映射
│  ├─ glossary.js               # 技术术语表（纠错 + 兜底）
│  ├─ payload.js                # 输出结构组装（接口与快照共用）
│  ├─ text-utils.js             # 文本清洗、数字友好化、B站时长解析
│  └─ md5.js                    # 纯 JS MD5（WBI 签名用，Workers 无 node:crypto）
├─ src/                         # 前端源码 → 构建时复制到 public/
│  └─ me/                       # 个人主页 / 收藏页（/me/）
├─ scripts/
│  ├─ build-static.mjs          # 生成 public/ 与静态快照
│  ├─ translate-local.mjs       # 构建期翻译（Cloudflare / OpenAI / MyMemory / 术语表）
│  ├─ serve.mjs                 # 本地静态预览服务器
│  ├─ test.mjs                  # 自测（含产物契约与可选联网集成测试）
│  ├─ preflight.mjs             # 推送前自检：扫描明文密钥、检查 gitignore 与 git 跟踪
│  ├─ check-render.mjs          # 浏览器端渲染验收（无头 Edge/Chrome）
│  ├─ seed-kv.mjs               # 把本地缓存（教程/译文/聚合）批量灌进 Cloudflare KV
│  ├─ probe-topics.mjs          # 统计快照中未收录的 topics，用于维护中文词表
│  └─ bili-wbi-probe.mjs        # B 站 WBI 接口探针（排查用）
├─ cache/                       # 增量缓存（提交到仓库）
├─ public/                      # 构建产物 = Pages 输出目录
└─ wrangler.toml                # Pages 配置（KV / AI 绑定）
```

## 本地运行

```bash
npm install                # 只有一个 devDependency（wrangler）

npm run build              # 联网抓数据 + 翻译 + 匹配教程，生成 public/
npm run preview            # 离线重建 + 启动 http://127.0.0.1:8788 静态预览
npm run dev                # wrangler pages dev：本地跑 Functions（需要真实 KV/AI 绑定）
npm test                   # 离线自测（82 项）
npm run test:all           # 追加联网集成测试：GitHub 接口 + B 站检索
npm run check:render       # 浏览器渲染验收：无头 Edge/Chrome 渲染首页并断言内容
npm run preflight          # 推送/部署前自检：扫密钥 + 检查 .gitignore 与 git 跟踪情况
npm run seed:kv            # 把本地缓存（教程/译文/聚合）灌进 Cloudflare KV（需 CLOUDFLARE_API_TOKEN）
```

可选环境变量（写入 `.dev.vars` 或 shell）：

| 变量 | 作用 |
| --- | --- |
| `GH_TOKEN` | GitHub 令牌，接口限额 10 次/分 → 30 次/分（强烈建议） |
| `BILI_COOKIE` | B 站 Cookie，降低风控概率（不配也能匿名检索） |
| `CF_ACCOUNT_ID` + `CF_AI_TOKEN` | 构建期用 Workers AI 翻译全部条目 |
| `OPENAI_API_KEY`（可选 `OPENAI_BASE_URL` / `OPENAI_MODEL`） | 改用 OpenAI 兼容接口翻译 |
| `TRANSLATE_MAX_CALLS` | 单次构建最多翻译多少条（默认 150，缓存会累积） |

## 部署到 Cloudflare Pages

> 本次已完成一次真实部署：<https://github-trending-zh.pages.dev>（项目名 `github-trending-zh`，
> 绑定 `TRENDING_KV` + `USER_DB`（D1）+ `AI`，已灌入 581 条缓存键、D1 迁移已应用）。以下三种方式任选其一。

### 方式一：命令行一键部署（最快）

```bash
npx wrangler login                       # 浏览器授权一次
npx wrangler kv namespace create TRENDING_KV   # 记下返回的 id
# 把 id 填进 wrangler.toml 的 kv_namespaces
npm run build
npx wrangler pages deploy public --project-name=github-trending-zh
```

之后在 Cloudflare 控制台的项目设置里添加变量：`GH_TOKEN`（建议）、`BILI_COOKIE`（可选）。
`TRENDING_KV` 与 `AI` 都已写在 `wrangler.toml`，Pages 会自动绑定，
`/api/health` 可以确认绑定是否生效。

### 方式二：GitHub Actions 自动部署（推荐长期使用）

1. 把本目录推到 GitHub 仓库。
2. 仓库 **Settings → Secrets and variables → Actions** 添加：
   - `CLOUDFLARE_API_TOKEN`（权限见 README「需要的 Cloudflare 权限」：Cloudflare Pages: Edit + Workers KV Storage: Edit + Account Settings: Read）
   - `CLOUDFLARE_ACCOUNT_ID`
   - `GH_TOKEN`（可选，建议）
   - `CF_ACCOUNT_ID` + `CF_AI_TOKEN`（可选，让静态快照也带完整翻译）
   - `BILI_COOKIE`（可选）
3. 推送后 `.github/workflows/deploy.yml` 会自动：构建 → 自测 → 提交缓存 → 部署。
   并默认**每天 01:15 UTC** 重建一次，让静态快照与缓存保持新鲜。

### 方式三：Cloudflare 控制台 Git 集成

在 Pages 里连接同一个仓库：构建命令 `node scripts/build-static.mjs`，输出目录 `public`，
同时 `functions/` 会被自动识别为 Pages Functions；再在 Settings 里补上 KV / AI 绑定与变量即可。
此方式**不需要 API Token**（走 Cloudflare 的 Git 授权），但 KV / AI 绑定与变量要在控制台手动加。

## 实测结论：Cloudflare 出口 IP 会被 B 站风控

真机部署后实测：`/api/health` 返回 `bilibili: { ok: false, error: "bili nav HTTP 412" }`，
即 B 站对 Cloudflare 的出口 IP 直接返回 412（风控页），**运行时抓教程基本不可用**；在本机/CI 上则正常。
因此教程数据采用「构建期为主 + 运行时尽力」的三层策略：

1. **构建期（主要来源）**：`npm run build` 抓取的教程写入 `cache/bili-cache.json`，并烘焙进 `public/data/*.json`。
2. **灌入 KV**：`npm run seed:kv` 把 `bili:v1:<仓库名>`、`zh:<原文哈希>`、`agg:v2:<周期>`
   批量写入 KV，线上接口直接命中；首屏 0.7 秒返回，且完全不依赖 B 站可达性。
   GitHub Actions 已内置这一步，所以每天的定时构建都会顺带刷新 KV。
3. **前端快照补全**：接口返回的项目若缺教程/译文，前端用同周期静态快照按 `fullName` 补齐，
   统计行会显示「构建快照补全 N 项」。

运行时另有**熔断**：连续 2 次失败即停止本轮 B 站请求，不做无谓消耗（见 `shared/bilibili.js`）。

## 存储分工：D1 存用户，KV 存缓存

| 数据 | 存储 | 原因 |
| --- | --- | --- |
| 用户 / 收藏 / B 站绑定 | **D1（SQLite）** | 免费额度 **10 万行写/天**，适合随用户操作频繁写入；支持 SQL 查询与索引 |
| 会话 | **签名 Cookie** | 无状态，登录不依赖任何存储写入 |
| 聚合结果 / 翻译 / 教程 / Star 采样 | **KV** | 读多写少、按 key 命中，缓存场景更合适 |

未绑定 D1 时会**自动回退**到 KV 存放用户数据（`/api/me` 会返回 `"store": "kv"`），功能不变、只是写入额度小。

> **本仓库当前的线上部署已启用 D1**：数据库 `github-trending-zh-users`
> （id `8d097c1b-38ca-473b-928e-63902ddc05e1`，区域 WNAM），`0001_init.sql` 已应用，
> 线上 `/api/me` 返回 `"store": "d1"`，`/api/health?full=1` 的存储探针全部为 `true`。
> GitHub Actions 每次部署前会自动 `d1 migrations apply`（幂等）。

### 启用 D1（三步）

```bash
npx wrangler d1 create github-trending-zh-users          # 1. 建库，记下 database_id
# 2. 把 wrangler.toml 里的 [[d1_databases]] 取消注释并填入 database_id
npx wrangler d1 migrations apply github-trending-zh-users --remote
# 或使用 npm 脚本：npm run db:create / npm run db:migrate / npm run db:migrate:local
```

表结构见 `migrations/0001_init.sql`：`users`（GitHub 资料 + 公开开关 + B 站绑定字段）
与 `favorites`（收藏 = 收藏那一刻的项目快照，`PRIMARY KEY (github_id, full_name)` 防重复）。
`login` 上建了 `COLLATE NOCASE` 唯一索引，因此按用户名查主页不区分大小写。

关键回归点（有单测覆盖）：**重新登录只更新登录相关字段，不会清掉收藏与 B 站绑定**（`ON CONFLICT(github_id) DO UPDATE` 只改 login/name/avatar/html_url/last_login_at）；
收藏排序用 `ORDER BY saved_at DESC, rowid DESC`，同一毫秒收藏两条时顺序依然确定。


## KV 写入预算（重要）

Cloudflare KV 免费额度是**每天 1000 次写 / 10 万次读**，按 **UTC 零点重置**。本站曾经踩过坑：
一次性灌 581 条缓存 + 每天 Star 采样 300 条 + 聚合缓存 144 条，把额度烧光后**登录写入失败**，
表现却是「登录成功但仍显示未登录」（写入错误被吞掉）。现在的策略：

| 写入来源 | 优化后估算 | 做法 |
| --- | --- | --- |
| 聚合缓存 `agg:v2:*` | ~24/天 | `CACHE_TTL=10800`（3 小时），而不是 30 分钟 |
| Star 采样 `star:v1:*` | ≤120/天 | 每仓库每天最多 1 次，且单次刷新最多 `STAR_SAMPLE_LIMIT=40` 个（按 Star 降序优先） |
| 教程缓存 `bili:v1:*` | ~0/天 | 只写真的抓到视频的项目，14 天 TTL；连续失败自动熔断 |
| 翻译缓存 `zh:*` | 几/天 | 只写新出现的描述 |
| 用户 / 收藏 / 会话 | **0/天** | 已迁到 D1；会话是签名 Cookie，都不占 KV 写入 |
| `seed-kv.mjs` 灌缓存 | 只写变化的键 | 先批量读现有值做 diff，跳过内容相同的键（`--force` 可全量覆盖） |

合计约 **150–200 次写/天**，为登录、收藏等用户写入留出充足余量（约 80% 空闲）。

会话设计：**HMAC-SHA256 签名 Cookie**（`SESSION_SECRET`，未配置则退回 `GITHUB_CLIENT_SECRET`），
所以**即使 KV 写额度用尽也能正常登录**；用户资料（收藏、B 站绑定）仍存 KV，
写入失败时接口返回 503 与明确原因，前端会显示持久提示而不是静默失败。

诊断入口：`/api/health?full=1` 会给出三项探针结果——
`diagnostics.kv`（KV 读写）、`diagnostics.session.kvSession` / `.signedSession`（会话两条路径）、
`oauth.credentialsValid`（GitHub 凭据是否有效）。

## Star 增长曲线是怎么来的

**GitHub 官方 API 不提供历史 Star 数据**（只给当前值），所以曲线由两部分组成，界面会明确区分：

1. **实测点（实线）**：站点每次刷新数据时把「时间 + 当前 Star」追加到 KV（键 `star:v1:<仓库名>`），
   同一个仓库一天只采样一次（≥24 小时才写第二点），单次刷新最多采样 `STAR_SAMPLE_LIMIT=40` 个
   （按 Star 降序优先），写入量控制在 KV 免费额度内。
   累积 ≥2 个点后显示为实线，并标注「近 N 天 +X ★（实测 M 个点）」。
2. **推算线（虚线）**：实测点不足时，用「创建至今的日均增速」画一条虚线，
   标注「日均 +X ★/天（按创建至今推算，实测曲线累积中）」。

也就是说：**刚上线时看到的是虚线推算，跑满两天后同一张卡片会自然变成实测折线**，
不存在伪造数据的情况。想立刻拿到多段实测曲线，可配置 `GH_TOKEN` 后扩展
`shared/star-history.js`，用 GitHub 的 `stargazers` + `application/vnd.github.star+json`
媒体类型拉取历史打点时间（需要配额，本仓库默认未启用）。

## 账号：GitHub 登录与关联 B 站

配置方式（**不配置也能正常浏览，只是没有登录入口**）：

1. 打开 <https://github.com/settings/developers> → **New OAuth App**
   - Homepage URL：`https://<你的域名>`
   - Authorization callback URL：`https://<你的域名>/api/auth/callback`
2. 把 Client ID / Client Secret 填到 Cloudflare Pages 的
   **Settings → Environment variables**：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`，然后重新部署。

实现要点：

- 会话令牌存在 KV（`session:v1:<token>`，30 天），浏览器只拿 `HttpOnly; Secure; SameSite=Lax` Cookie；
- **不保存 GitHub access token**，只用它读一次 `/user` 拿身份；
- 所有写操作校验同源（`Origin` 与站点一致），配合 SameSite 防 CSRF；
- 用户数据存 `user:v1:<githubId>`：GitHub 资料 + 收藏（≤500 个）+ B 站绑定。

**关联 B 站**（无需 B 站开放平台审核）：
点「获取验证码」→ 把形如 `GTZ-4F3A2C` 的验证码写进 B 站「个人中心 → 编辑资料 → 签名」并保存 →
回到面板填 B 站 UID 点「验证并保存」。服务端用 WBI 签名的 `/x/space/wbi/acc/info` 读取你的公开签名做校验：
- 校验通过 → 标记「已验证」并显示你的 B 站昵称与空间链接；
- 接口不可达（B 站对云服务器常返回 412）或签名里还没写验证码 → 先记录绑定并如实标为「待验证」，可随时点「重新校验」。

## 收藏页 / 个人主页

| 地址 | 说明 |
| --- | --- |
| `/me/` | 自己的收藏管理页（需登录）：筛选、按收藏时间/Star/名称排序、单个移除、复制分享链接、公开开关 |
| `/me/?u=<GitHub用户名>` | **可分享的公开收藏页**（只读）：展示对方公开的收藏与已关联的 B 站信息 |

设计要点：

- **收藏时把项目快照一起存进 KV**（`user:v1:<githubId>.favoriteItems`）：字段经 `sanitizeFavoriteItem()`
  清洗（仓库名正则、URL 必须 https、头像必须 https、描述截断 300 字、topics 最多 5 个、上限 500 个收藏）。
  所以个人主页渲染**完全不请求 GitHub 接口**，不受 API 限流影响，也不依赖榜单当天是否收录该项目。
- **公开可见性**：默认公开，用户可一键「设为不公开」，此时 `/api/profile` 返回 403。
  公开视图 `publicProfile()` **不含** B 站验证码、GitHub ID、会话令牌等内部字段（有测试兜底）。
- **登录名索引**：`login:v1:<小写登录名>` → GitHub ID，供按用户名访问主页使用。
- **快照的取舍**：卡片显示的是「收藏那一刻」的 Star 与描述（页面已注明），点项目名可看最新数据；
  这样既省接口配额，也避免展示过期数据引起误解。

API：`GET /api/profile?u=<登录名>`（公开，60 秒缓存）、`POST /api/me`
（`favorite` / `unfavorite` / `set-visibility` / `bilibili-code` / `bind-bilibili` / `verify-bilibili` / `unbind-bilibili`）。

## 轮换 Cloudflare API Token 后要改哪些地方

**结论：项目文件里没有任何地方保存这个 token**（`npm run preflight` 会扫描整个工作区确认：
「工作区未发现明文密钥」）。它只在**执行部署/管理命令**时作为环境变量传入，所以轮换后只需要动这几处：

| 位置 | 是否要改 | 说明 |
| --- | --- | --- |
| GitHub 仓库 **Secrets → `CLOUDFLARE_API_TOKEN`** | ✅ 必须 | CI 部署用，换成新 token |
| 本地 shell（当前会话里 `export` 的变量） | ✅ 关掉终端即可 | 只在该会话有效，不落盘 |
| 本地 `.dev.vars`（若你在里面写过） | ⚠️ 视情况 | 已被 `.gitignore` 忽略，不会提交；改了值记得同步 |
| Cloudflare 控制台 → API Tokens | ✅ 建新 / Roll 旧 | 新 token 权限见上文权限表 |
| **Cloudflare Pages → Settings → Environment variables** | ❌ 不需要 | 站点运行时的 Functions 用的是平台注入的绑定（KV/D1/AI），**不需要 API Token** |
| `wrangler.toml` | ❌ 不需要 | 里面只有 KV 命名空间 id 与 D1 database id，都是标识符不是机密 |
| 已部署的站点产物 | ❌ 不需要 | 构建产物里不含 token |

新 token 的最小权限组合：**Cloudflare Pages: Edit** + **Workers KV Storage: Edit** + **D1: Edit** + **Account Settings: Read**（Account 级）。

> 另外注意区分：`GH_TOKEN`（GitHub 只读令牌，仅用于提高接口限额）、`GITHUB_CLIENT_ID/SECRET`（OAuth App）、
> `BILI_COOKIE`、`SESSION_SECRET` 都是**另一套**凭据，与 Cloudflare token 无关。
> ⚠️ 特别提醒：若轮换 `GITHUB_CLIENT_SECRET`，**签名会话会全部失效**（`SESSION_SECRET` 未单独设置时默认回退用它），
> 用户需要重新登录。想避免这种联动，就单独设一个固定的 `SESSION_SECRET`。

提交到 GitHub 之前，先跑一次自检：

```bash
npm run preflight     # 扫密钥 + 检查 .gitignore / wrangler.toml / git 跟踪情况
```

## 推到 GitHub 并配置 5 个 Secrets（教程）

```bash
cd github-trending-zh

# 0）先自检：确认没有密钥会被提交
npm run preflight

# 1）初始化仓库（cache/ 与 public/ 是要提交的：CI 会把刷新后的数据提交回来）
git init
git add -A
git commit -m "feat: GitHub 热门中文榜（周/月/年 + 分区 + B站教程 + Star 曲线 + 登录收藏）"

# 2）在 GitHub 建空仓库（不要勾选 README/gitignore），然后
git branch -M main
git remote add origin https://github.com/<你的用户名>/github-trending-zh.git
git push -u origin main
```

> 也可以用 `gh repo create github-trending-zh --private --source=. --push`（需要已登录 `gh`）。

### Secrets 清单（仓库 → Settings → Secrets and variables → Actions → New repository secret）

工作流里实际用到的有 **2 个必需 + 1 个建议 + 2 个可选**：

| Secret | 谁在用 | 用途 | 必填 |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | CI：部署 Pages / 灌 KV / 应用 D1 迁移 | 权限见上文权限表 | ✅ 必需 |
| `CLOUDFLARE_ACCOUNT_ID` | CI | 同上（`npx wrangler whoami` 可查） | ✅ 必需 |
| `GH_TOKEN` | CI：构建时抓 GitHub | 接口限额 10 次/分 → 30 次/分（GitHub → Settings → Developer settings → PAT，只读 public repo 即可） | 建议 |
| `BILI_COOKIE` | CI：构建时抓 B 站教程 | 降低 B 站风控概率（可选） | 可选 |
| `CF_ACCOUNT_ID` + `CF_AI_TOKEN` | CI：构建期翻译 | 用 Workers AI 把描述全量译成中文（`CF_AI_TOKEN` 需要 `Workers AI: Read` 权限） | 可选 |

> 也可以用 `OPENAI_API_KEY`（+ 可选 `OPENAI_BASE_URL` / `OPENAI_MODEL`，如 DeepSeek、通义、Kimi）替代上一行的翻译方案。
> 未配置翻译密钥时构建仍会成功，只是静态快照里的译文变少（运行时的 Workers AI 绑定会继续补译）。
>
> ⚠️ **`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 不是 CI Secret**：站点运行时的 Pages Functions 才需要它们，
> 必须配置在 **Cloudflare Pages → Settings → Environment variables（Production）**。放到 Actions Secrets 里对站点没有作用。

### 触发与验证

- 推送到 `main` 会自动跑一次；也可在仓库 **Actions → 构建并部署到 Cloudflare Pages → Run workflow** 手动触发。
- 每天 **01:15 UTC**（北京时间 09:15）自动重建一次数据。
- 工作流顺序：自检 → 构建 → 自测 → 提交缓存 → 灌 KV → 应用 D1 迁移 → 部署。
- 验证线上状态：<https://你的域名/api/health?full=1>（`bindings` 三个绑定为 true，`diagnostics.userStore.kind` 为 `d1`）。

## 需要的 Cloudflare 权限（API Token）

创建路径：控制台右上角头像 → **My Profile → API Tokens → Create Token → Custom token**。

| 用途 | 权限类别 | 级别 | 是否必须 |
| --- | --- | --- | --- |
| 部署 Pages：创建项目、上传产物、应用 `wrangler.toml` 里的 KV / AI 绑定 | **Cloudflare Pages: Edit** | Account | ✅ 必须 |
| 部署时读取 KV 命名空间并把绑定写入项目 | **Workers KV Storage: Edit** | Account | ✅ 需要（若 KV 已在控制台建好且你只部署不改绑定，可退为 Read） |
| 创建 D1 数据库并执行迁移（用户/收藏数据） | **D1: Edit** | Account | 需要（仅建库与迁移时用；站点运行时不需要 API Token） |
| wrangler 解析账号（`whoami`、自动选账号） | **Account Settings: Read** | Account | 建议（若已显式设置 `CLOUDFLARE_ACCOUNT_ID` 可省） |
| 构建期用 REST API 调 Workers AI 翻译静态快照（CI 里的 `CF_AI_TOKEN`） | **Workers AI - Read** | Account | 可选（官方 REST API 指南建议同时给 `Workers AI - Edit`） |
| 让脚本自动把自定义域名绑到 Pages 项目 | **Zone → DNS: Edit** + Zone:Read（限定该域名） | Zone | 可选 |

> 上表权限名与 Dashboard 一致：Pages 的路径是 `Account → Cloudflare Pages → Edit`
> （Cloudflare 官方 CI 指南原文："Under **Permissions**, select *Account*, *Cloudflare Pages* and *Edit*"）；
> KV 在令牌界面的分组名是 **Workers KV Storage**（少数旧界面显示为 Workers KV），Scope 选 Edit。

**最小可用组合**：`Cloudflare Pages: Edit` + `Workers KV Storage: Edit` + `Account Settings: Read`（Account 级别）。

**不需要**的权限：Workers Scripts、R2、D1、Queues、Zone 的 DNS/缓存/WAF（除非要自动绑自定义域名）。

资源范围建议（Token 创建页面的下方两个下拉框）：
- **Account resources**：只勾选你自己的账号，不要选 `All accounts`。
- **Zone resources**：没加 Zone 权限就不用管；加了就只勾目标域名。

三个容易搞混的点：

1. **运行时用 Workers AI 不需要 API Token**。`wrangler.toml` 里的 `[ai] binding = "AI"` 是平台注入的绑定，
   只有「构建期在本机/CI 用 REST 调 AI 翻译」才需要 `Workers AI` 权限和 `CF_AI_TOKEN`。
2. **`npx wrangler login` 走 OAuth，不用建 Token**；API Token 只用于 CI 或无浏览器环境。
3. Tab 里的 **Workers Scripts: Edit 不等于 Pages 权限**，只给它是部署不了 Pages 的。

验证方式：

```bash
npx wrangler whoami                        # 列出当前 Token 的账号与权限范围
curl https://<你的项目>.pages.dev/api/health   # 看 TRENDING_KV / AI 是否为 true
```

Token 明文只在创建时显示一次，创建后请立即保存到 GitHub Secrets 或 `.dev.vars`（已在 `.gitignore` 中忽略）。

## 数据口径与实现细节

- **热门口径**：GitHub 官方 Search API，查询 `created:>=周期起始日 stars:>=阈值` 并按 Star 降序
  ——即「该周期内新创建且最受关注的项目」。这是可复现、无第三方依赖的口径，
  与 GitHub 官方 Trending 页（按近期 Star 增量）算法不同，页面与 README 都已如实标注。
- **分区**：`topics` 命中 +3 分/条（上限 9）、关键词命中 +2 分/条（上限 6）、语言命中 +1 分，
  取最高分分区，低于 3 分归入「其他」。
- **B 站教程**：`/x/web-interface/nav` 取 WBI 密钥 → 对 `已排序参数 + mixinKey` 做 MD5 得到 `w_rid`
  → 调用 `/x/web-interface/wbi/search/type`。标题会清洗 `<>` 高亮标签并解码 HTML 实体；
  打分规则**要求标题里必须出现项目名**（宁缺毋滥），再按教程词、时长（2 分钟～2 小时）、
  播放量加分，广告/超短视频减分，未达标就退回 B 站搜索链接。
- **翻译**：运行时按 `KV 缓存 → Workers AI → 术语表` 逐级降级；构建期可用
  Cloudflare / OpenAI / MyMemory（免密钥）/ 纯术语表。**翻译失败会显示英文原文而不是编造译文**，
  卡片上同时保留原文便于核对。
- **缓存与成本**：聚合结果缓存 30 分钟；翻译键 90 天；教程键 14 天；
  每次请求最多新增 6 条 B 站检索（`BILI_FILL_BUDGET`），避免触发风控。

## 配置项速查（Pages 环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `GH_TOKEN` | 空 | GitHub 令牌，提升接口限额 |
| `FETCH_LIMIT` | 100 | 每周期抓取项目数（Search API 上限 100） |
| `CACHE_TTL` | 1800 | 聚合结果缓存秒数 |
| `BILI_FILL_BUDGET` | 6 | 单次请求最多新增的 B 站检索数量 |
| `BILI_COOKIE` | 空 | B 站 Cookie |
| `TRANSLATE_BUDGET` | 60 | 单次请求最多翻译条数 |
| `DISABLE_AI_TRANSLATE` | false | 设为 `true` 则只用术语表兜底 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 空 | GitHub 登录（OAuth App）；不配则隐藏登录入口 |

## 自测与验收

`npm test` 覆盖 150 项：MD5 已知向量、分类规则、文本清洗、翻译判定、GitHub 查询构造、
WBI 签名确定性与复现性、教程相关度打标（含「同名但非教程内容必须被拒绝」）、
Star 曲线的实测/推算判定与采样节流、Cookie 与同源校验、会话生命周期、用户视图不泄露令牌、
收藏快照校验与公开主页字段裁剪、**D1 存储用 node:sqlite 跑真实 SQL**（建表迁移、大小写不敏感查询、
收藏增删去重与排序兜底、重新登录保留收藏/绑定、用户间隔离）、两个页面的 DOM 契约、
静态快照字段与前端字段一一对齐、以及**快照项目数与抓取结果一致**。
`npm run test:all` 额外真实调用 Pages Function 与 B 站接口。测试报告写入 `test-report.txt`。

## 已知限制

- GitHub Search API 匿名限额 10 次/分，未配置 `GH_TOKEN` 时若缓存失效可能触发 403（页面会显示静态快照）。
- B 站接口是公开接口（非官方开放 API）。**实测 Cloudflare 出口 IP 会被稳定 412 风控**，
  运行时抓不到教程；教程数据因此以「构建期抓取 + 灌入 KV」为主，页面始终保留 B 站搜索入口
  （详见上文「实测结论」）。同一原因，**关联 B 站的自动校验在线上通常拿不到结果**，
  会如实显示为「待验证」。
- Star 曲线刚部署时是「按日均增速推算」的虚线，需要累积 ≥2 次采样（约 1–2 天）才会变成实测折线。
- 机器翻译会有误差，专有名词已用术语表与 topics 词表兜底，但仍建议以原文为准。
- GitHub 与哔哩哔哩内容版权归原作者所有，本站仅做聚合与跳转。

## 管理后台（管理员）

站点内置管理后台 `/admin/`：登录的管理员可以浏览**所有已登录用户**及其**收藏列表、B 站绑定**。

- 谁算管理员：在 Cloudflare Pages → Settings → Environment variables 添加 `ADMIN_LOGINS`，
  值为**逗号分隔的 GitHub 用户名**（大小写不敏感），例如 `ADMIN_LOGINS=你的用户名,另一个用户名`。
- 未配置 `ADMIN_LOGINS` 时任何人都不是管理员，`/admin/` 会提示「没有管理员权限」。
- 权限在服务端校验（签名 Cookie 判定登录 + 登录名匹配），前端只做展示。
- 管理后台需要 D1（USER_DB）才能枚举用户；KV 兜底模式不支持列出全部用户。

## 许可

本项目源码基于 **Mozilla Public License 2.0（MPL-2.0）** 授权，许可证全文见仓库根目录的 [`LICENSE`](./LICENSE)。

要点（仅为便于理解的概括，不构成法律意见，以 LICENSE 原文为准）：

- 可自由使用、修改、分发，**包括商业用途**；
- MPL 是**文件级 copyleft**：若你修改了本项目中受 MPL 覆盖的文件，该文件的修改版需继续以 MPL 公开；
  未修改的文件、以及与之组合的独立模块**不强制开源**；
- 分发时需保留版权与许可声明。

聚合内容（GitHub 项目信息、哔哩哔哩视频信息）的版权归各自作者与平台所有，
本站仅做聚合与跳转，分别遵循 GitHub 服务条款与哔哩哔哩用户协议。

