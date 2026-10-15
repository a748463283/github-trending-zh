/**
 * 分区规则引擎（前端 / Pages Functions / 构建脚本 共用）
 *
 * 打分规则：
 *   - 命中 topics / 名称 / 描述里的条目：+3 分/条，上限 9 分
 *   - 命中关键词列表：+2 分/条，上限 6 分
 *   - 命中编程语言：+1 分
 * 取总分最高的分区；总分 < 3 归入「其他」。
 * 平局时取书写顺序靠前的分区（顺序即优先级）。
 */

export const OTHER_CATEGORY = {
  id: 'other',
  name: '其他',
  emoji: '📦',
  desc: '暂未归类的热门项目',
  topics: [],
  keywords: [],
  langs: [],
};

export const CATEGORIES = [
  {
    id: 'ai-plugin',
    name: 'AI 插件 / Agent 扩展',
    emoji: '🧩',
    desc: '浏览器插件、编辑器插件、MCP 工具与 Claude/ChatGPT 扩展',
    topics: [
      'mcp', 'model-context-protocol', 'chatgpt-plugin', 'copilot', 'browser-extension',
      'chrome-extension', 'vscode-extension', 'obsidian-plugin', 'raycast-extension',
      'claude', 'claude-code', 'cursor', 'ai-agent', 'agent-skills', 'skills',
      'browser-automation', 'playwright-mcp',
    ],
    keywords: [
      'mcp server', 'model context protocol', 'claude code', 'claude-code', 'copilot',
      'browser extension', 'chrome extension', 'vscode extension', 'vscode plugin',
      'obsidian plugin', 'browser plugin', 'chatgpt plugin', 'ai plugin', 'agent skill',
      'prompt library',
    ],
    langs: [],
  },
  {
    id: 'ai',
    name: 'AI 与大模型',
    emoji: '🤖',
    desc: '大模型、推理框架、RAG、语音与图像生成',
    topics: [
      'ai', 'artificial-intelligence', 'llm', 'llms', 'large-language-model', 'machine-learning',
      'deep-learning', 'transformers', 'gpt', 'chatgpt', 'deepseek', 'rag', 'langchain',
      'llmops', 'fine-tuning', 'nlp', 'computer-vision', 'pytorch', 'tensorflow', 'vllm',
      'diffusion', 'stable-diffusion', 'text-to-image', 'text-to-speech', 'speech-recognition',
      'whisper', 'ollama', 'llama', 'multimodal', 'embedding', 'inference-engine', 'agent',
      'agents', 'generative-ai', 'openai', 'gemini',
    ],
    keywords: [
      'llm', 'gpt', 'chatgpt', 'deepseek', 'claude', 'ollama', 'llama', 'qwen', 'gemini',
      'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
      'diffusion', 'text-to-image', 'text to speech', 'speech recognition', 'whisper',
      'fine-tune', 'rag', 'vector search', 'inference', 'multimodal', 'prompt', 'ai model',
      '大模型', 'agent framework', 'vision language',
    ],
    langs: [],
  },
  {
    id: 'printer3d',
    name: '3D 打印与建模',
    emoji: '🖨️',
    desc: '3D 打印机固件、切片软件、CAD 与建模工具',
    topics: [
      '3d-printing', '3d-printer', '3dprinting', 'klipper', 'marlin', 'octoprint', 'slicer',
      'gcode', 'stl', 'cad', 'openscad', 'freecad', 'mesh', '3d', '3d-model', 'blender',
      'blender-addon', 'blender-plugin', 'cnc', 'laser-engraver', 'laser-cutter', 'voron',
      'bambu', 'prusa', 'meshlab', 'point-cloud', 'parametric-design',
    ],
    keywords: [
      '3d print', '3d-print', '3d printer', '3dprinting', 'klipper', 'marlin', 'octoprint',
      'slicer', 'gcode', 'openscad', 'freecad', 'blender addon', 'blender plugin', 'cad',
      'cnc', 'laser engraver', 'step file', 'mesh', 'bambu lab', 'prusa', 'resin print',
      '建模', '三维', '雕刻机',
    ],
    langs: ['G-code', 'OpenSCAD'],
  },
  {
    id: 'hardware',
    name: '硬件 / 嵌入式 / 物联网',
    emoji: '🔌',
    desc: '单片机固件、开发板、智能家居与机器人',
    topics: [
      'arduino', 'esp32', 'esp8266', 'raspberry-pi', 'embedded', 'iot', 'firmware',
      'microcontroller', 'electronics', 'rp2040', 'stm32', 'home-assistant', 'robotics',
      'esphome', 'zigbee', 'rtos', 'fpga', 'sdr', 'circuitpython', 'raspberrypi',
    ],
    keywords: [
      'arduino', 'esp32', 'esp8266', 'raspberry pi', 'embedded', 'firmware', 'microcontroller',
      'iot', 'robotics', 'home assistant', 'esphome', 'zigbee', '开发板', '单片机',
      'smart home', 'pcb', '机器人',
    ],
    langs: [],
  },
  {
    id: 'selfhost',
    name: '自托管与服务端',
    emoji: '🏠',
    desc: '开源自托管应用、容器化部署与运维基建',
    topics: [
      'self-hosted', 'selfhosted', 'homelab', 'docker', 'docker-compose', 'kubernetes',
      'k8s', 'server', 'nas', 'devops', 'infrastructure', 'paas', 'monitoring', 'grafana',
      'prometheus', 'traefik', 'nginx', 'reverse-proxy', 'terraform', 'ansible', 'helm',
      'cloud-native', 'caddy', 'minio', 'vps',
    ],
    keywords: [
      'self-host', 'selfhost', 'homelab', 'docker', 'kubernetes', 'nas', 'devops', 'deploy',
      'reverse proxy', 'monitoring', 'infrastructure', 'panel', '管理面板', '部署', '服务器',
      'container', 'orchestration',
    ],
    langs: ['Dockerfile', 'HCL', 'Shell'],
  },
  {
    id: 'security',
    name: '安全与隐私',
    emoji: '🔐',
    desc: '渗透测试、漏洞研究、隐私保护与加密',
    topics: [
      'security', 'cybersecurity', 'penetration-testing', 'pentest', 'hacking', 'ctf',
      'malware', 'reverse-engineering', 'privacy', 'encryption', 'vpn', 'firewall', 'osint',
      'vulnerability', 'exploit', 'red-team', 'blue-team', 'forensics', 'keylogger',
      'password-manager', 'cryptography', 'bugbounty',
    ],
    keywords: [
      'security', 'pentest', 'penetration test', 'exploit', 'vulnerability', 'malware',
      'reverse engineering', 'privacy', 'encrypt', 'vpn', 'firewall', 'osint', 'ctf',
      'password manager', 'security scanner', '安全', '漏洞', '渗透', '免杀', '脱壳',
    ],
    langs: [],
  },
  {
    id: 'game',
    name: '游戏与娱乐',
    emoji: '🎮',
    desc: '游戏引擎、开源游戏、模拟器与模组',
    topics: [
      'game', 'gamedev', 'game-development', 'game-engine', 'unity', 'unreal-engine',
      'godot', 'minecraft', 'emulator', 'steam', 'mod', 'rom', 'game-server', 'pixel-art',
      'raylib', 'quake', 'doom', 'nintendo', 'playstation', 'retro-gaming',
    ],
    keywords: [
      'game engine', 'gamedev', 'game development', 'unity', 'unreal', 'godot', 'minecraft',
      'emulator', 'game mod', 'steam', 'retro game', '游戏', '模拟器', '单机', '我的世界',
    ],
    langs: ['GLSL', 'HLSL', 'ShaderLab'],
  },
  {
    id: 'web',
    name: 'Web 前端',
    emoji: '🌐',
    desc: '前端框架、UI 组件库、建站模板与动效',
    topics: [
      'react', 'vue', 'vue3', 'svelte', 'nextjs', 'nuxt', 'tailwindcss', 'typescript',
      'javascript', 'css', 'html', 'ui', 'component-library', 'frontend', 'web', 'webapp',
      'design-system', 'animation', 'ui-components', 'tailwind', 'htmx', 'astro',
      'landing-page', 'template', 'shadcn-ui', 'ui-library', 'figma',
    ],
    keywords: [
      'react', 'vue', 'svelte', 'next.js', 'nextjs', 'nuxt', 'tailwind', 'frontend',
      'component library', 'ui library', 'design system', 'css', 'landing page', 'website',
      'web app', 'dashboard template', '前端', '组件库', '建站', '网站模板',
    ],
    langs: ['TypeScript', 'JavaScript', 'CSS', 'SCSS', 'Vue', 'Svelte', 'HTML'],
  },
  {
    id: 'media',
    name: '音视频与图像',
    emoji: '🎬',
    desc: '播放器、剪辑、下载、录屏与图像处理',
    topics: [
      'video', 'audio', 'ffmpeg', 'music', 'image', 'photo', 'video-editing', 'streaming',
      'subtitle', 'podcast', 'screen-recording', 'downloader', 'player', 'youtube',
      'video-player', 'image-processing', 'ocr', 'media', 'gif', 'youtube-downloader',
      'spotify', 'text-to-video', 'video-generation',
    ],
    keywords: [
      'video', 'audio', 'ffmpeg', 'music', 'photo', 'image', 'player', 'stream', 'subtitle',
      'downloader', 'screenshot', 'screen record', 'video editing', 'ocr', '视频', '音频',
      '字幕', '下载器', '剪辑', '播放器', '图片', '壁纸',
    ],
    langs: [],
  },
  {
    id: 'data',
    name: '数据与数据库',
    emoji: '📊',
    desc: '数据库、数据分析、可视化与数据管道',
    topics: [
      'database', 'sql', 'nosql', 'postgres', 'postgresql', 'sqlite', 'redis', 'analytics',
      'data-engineering', 'etl', 'big-data', 'visualization', 'dashboard', 'vector-database',
      'search-engine', 'data-science', 'data-analysis', 'olap', 'duckdb', 'clickhouse',
      'data-visualization', 'charts', 'spreadsheet', 'excel', 'business-intelligence',
    ],
    keywords: [
      'database', 'sql', 'analytics', 'data pipeline', 'etl', 'visualization', 'chart',
      'dataframe', 'data warehouse', 'spreadsheet', 'excel', 'data analysis', 'bi tool',
      '数据', '图表', '数据库', '报表', '表格',
    ],
    langs: ['Jupyter Notebook'],
  },
  {
    id: 'devtools',
    name: '开发工具与效率',
    emoji: '🛠️',
    desc: '命令行工具、编辑器配置、API 调试与工程效率',
    topics: [
      'developer-tools', 'cli', 'command-line', 'terminal', 'vim', 'neovim', 'dotfiles',
      'productivity', 'editor', 'ide', 'code-editor', 'tui', 'shell', 'zsh', 'bash', 'git',
      'api-client', 'testing', 'playwright', 'debugging', 'code-quality', 'lint', 'sdk',
      'codegen', 'syntax-highlighting', 'http-client',
    ],
    keywords: [
      'cli', 'command line', 'terminal', 'neovim', 'vscode', 'ide', 'code editor',
      'developer tool', 'productivity', 'workflow', 'automation', 'dotfiles', 'api client',
      'test framework', 'debugger', 'code generator', '效率', '命令行', '工具箱', '脚手架',
    ],
    langs: ['Vim Script', 'Lua', 'Go', 'Rust', 'Zig'],
  },
  {
    id: 'os',
    name: '操作系统与虚拟化',
    emoji: '💻',
    desc: 'Linux 发行版、内核、虚拟化与底层系统',
    topics: [
      'linux', 'operating-system', 'kernel', 'unix', 'windows', 'macos', 'virtualization',
      'bsd', 'bootloader', 'hypervisor', 'filesystem', 'driver', 'syscall', 'grub',
      'wayland', 'desktop-environment', 'nixos', 'archlinux',
    ],
    keywords: [
      'linux', 'kernel', 'distro', 'operating system', 'unix', 'virtualization', 'hypervisor',
      'filesystem', 'bootloader', 'wayland', '窗口管理器', '操作系统', '内核', '国产系统',
    ],
    langs: ['Assembly', 'C', 'Rust'],
  },
  {
    id: 'mobile',
    name: '移动与跨端',
    emoji: '📱',
    desc: 'Android / iOS 应用、跨端框架与桌面客户端',
    topics: [
      'android', 'ios', 'flutter', 'react-native', 'swift', 'kotlin', 'mobile', 'app',
      'wechat', 'mini-program', 'harmonyos', 'xposed', 'adb', 'jetpack-compose', 'swiftui',
      'tauri', 'electron',
    ],
    keywords: [
      'android', 'ios app', 'flutter', 'react native', 'swift', 'kotlin', 'mobile app',
      'apk', 'mini program', '小程序', '安卓', '鸿蒙', '跨端', '桌面应用', '微信',
    ],
    langs: ['Dart', 'Kotlin', 'Swift', 'Objective-C', 'Java'],
  },
  {
    id: 'blockchain',
    name: '区块链与 Web3',
    emoji: '⛓️',
    desc: '公链、智能合约、DeFi 与钱包工具',
    topics: [
      'blockchain', 'cryptocurrency', 'bitcoin', 'ethereum', 'web3', 'smart-contracts',
      'defi', 'nft', 'solana', 'solidity', 'wallet', 'evm', 'dex', 'staking', 'airdrop',
    ],
    keywords: [
      'blockchain', 'crypto', 'bitcoin', 'ethereum', 'web3', 'smart contract', 'defi',
      'wallet', 'solana', 'solidity', '空投', '区块链', '量化交易', 'trading bot',
    ],
    langs: ['Solidity', 'Vyper', 'Move', 'Cairo'],
  },
  {
    id: 'science',
    name: '科研与仿真',
    emoji: '🔬',
    desc: '科学计算、仿真、生物信息与数学工具',
    topics: [
      'science', 'simulation', 'physics', 'chemistry', 'biology', 'mathematics', 'research',
      'bioinformatics', 'quantum-computing', 'astronomy', 'geospatial', 'numerical-methods',
      'finite-element', 'cfd', 'matlab',
    ],
    keywords: [
      'simulation', 'physics engine', 'chemistry', 'biology', 'mathematics', 'research paper',
      'quantum', 'astronomy', 'geospatial', 'finite element', '仿真', '科学计算', '论文',
      '有限元', '流体', '数值计算',
    ],
    langs: ['MATLAB', 'Fortran', 'Julia', 'R'],
  },
  {
    id: 'learning',
    name: '学习与资源合集',
    emoji: '📚',
    desc: 'Awesome 列表、教程、路线图与面试资料',
    topics: [
      'awesome', 'awesome-list', 'tutorial', 'course', 'learning', 'education', 'books',
      'roadmap', 'interview', 'cheatsheet', 'resources', 'guide', 'examples', 'documentation',
      'best-practices', 'interview-questions', 'free-programming-books', 'tutorials',
    ],
    keywords: [
      'awesome', 'curated list', 'tutorial', 'course', 'learn', 'book', 'roadmap',
      'interview', 'cheatsheet', 'guide', 'from scratch', 'handbook', '教程', '学习路线',
      '面试', '资源合集', '中文文档', '指南',
    ],
    langs: [],
  },
];

export const ALL_CATEGORIES = [...CATEGORIES, OTHER_CATEGORY];

const SCORE_THRESHOLD = 3;

function hit(list, text) {
  let n = 0;
  for (const item of list) if (text.includes(item)) n += 1;
  return n;
}

/**
 * 为一个仓库选出分区 id
 * @param {{name?:string, description?:string, topics?:string[], language?:string}} repo
 * @returns {string} 分区 id
 */
export function classifyRepo(repo) {
  const topics = (repo.topics || []).map((t) => String(t).toLowerCase());
  const name = String(repo.name || '').toLowerCase();
  const desc = String(repo.description || '').toLowerCase();
  const language = String(repo.language || '').toLowerCase();
  const text = `${name} ${desc} ${topics.join(' ')}`;

  let best = null;
  let bestScore = 0;

  for (const cat of CATEGORIES) {
    let score = 0;
    score += Math.min(hit(cat.topics, text) * 3, 9);
    score += Math.min(hit(cat.keywords, text) * 2, 6);
    if (cat.langs.some((l) => l.toLowerCase() === language)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = cat.id;
    }
  }

  return bestScore >= SCORE_THRESHOLD && best ? best : OTHER_CATEGORY.id;
}

export function categoryById(id) {
  return ALL_CATEGORIES.find((c) => c.id === id) || OTHER_CATEGORY;
}

