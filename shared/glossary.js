/**
 * 中英术语表：
 *   1) 机器翻译后的术语纠错（AI 常把专有名词译歪）
 *   2) 无 AI 时的短语级兜底翻译
 * 规则按长度降序应用，先长后短，避免子串重复替换。
 */

export const GLOSSARY = [
  ['self-hosted', '自托管'], ['self hostable', '可自托管'], ['open-source', '开源'],
  ['open source', '开源'], ['cross-platform', '跨平台'], ['command-line', '命令行'],
  ['command line', '命令行'], ['one-click', '一键'], ['out of the box', '开箱即用'],
  ['drop-in replacement', '可直接替换'], ['state of the art', '最先进'],
  ['zero configuration', '零配置'], ['zero-config', '零配置'], ['plug and play', '即插即用'],
  ['all-in-one', '一体化'], ['end-to-end', '端到端'], ['real-time', '实时'],
  ['offline-first', '离线优先'], ['local-first', '本地优先'], ['no dependencies', '零依赖'],
  ['batteries included', '开箱即用'], ['blazingly fast', '极速'], ['lightweight', '轻量级'],
  ['framework', '框架'], ['toolkit', '工具包'], ['library', '库'], ['extension', '扩展'],
  ['plugin', '插件'], ['dashboard', '仪表盘'], ['web scraping', '网页采集'],
  ['natural language processing', '自然语言处理'], ['machine learning', '机器学习'],
  ['deep learning', '深度学习'], ['large language model', '大语言模型'],
  ['artificial intelligence', '人工智能'], ['computer vision', '计算机视觉'],
  ['speech recognition', '语音识别'], ['text to speech', '语音合成'],
  ['image generation', '图像生成'], ['video generation', '视频生成'],
  ['3d printer', '3D 打印机'], ['3d printing', '3D 打印'], ['operating system', '操作系统'],
  ['package manager', '包管理器'], ['version control', '版本控制'], ['data pipeline', '数据管道'],
  ['message queue', '消息队列'], ['load balancer', '负载均衡'], ['reverse proxy', '反向代理'],
  ['static site generator', '静态站点生成器'], ['headless', '无头模式'],
  ['self-hosted alternative', '自托管替代方案'],

  // 机器翻译常见误译纠正（同时作用于运行时 AI 输出与构建期缓存）
  ['安德烈·卡帕蒂', 'Andrej Karpathy'],
  ['克劳德代码', 'Claude Code'], ['克劳德', 'Claude'],
  ['存储库', '代码仓库'], ['仓库管理器', '仓库管理器'],
  ['应用程序接口', 'API'], ['命令行界面', '命令行'], ['自动完成', '自动补全'],
  ['浏览器扩展程序', '浏览器扩展'], ['插件程序', '插件'], ['陈旧', '过时'],
  ['大语言模型接口', '大模型 API'],
];

// 按英文长度降序，保证长词组优先替换
const SORTED = [...GLOSSARY].sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RULES = SORTED.map(([en, zh]) => [new RegExp(escapeRegExp(en), 'gi'), zh]);

/** 用术语表修正译文中的专有名词，并清理中文字符间多余空格 */
export function applyGlossary(text) {
  let out = String(text || '');
  for (const [re, zh] of RULES) out = out.replace(re, zh);

  // 术语替换后会出现「跨平台 工具包」这类多余空格，中文之间不应有空格
  for (let i = 0; i < 3; i += 1) {
    out = out.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
  }
  out = out.replace(/\s+([，。、；：！？）】」》])/g, '$1')
    .replace(/([（【「《])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ');
  return out;
}

/**
 * 无 AI 时的兜底翻译：只做短语替换。
 * 若替换后英文残留比例仍很高（>35%），说明没把握译好，返回空串，
 * 由调用方显示原文并标注「未翻译」，不编造译文。
 */
export function fallbackTranslate(text) {
  const src = String(text || '');
  if (!src) return '';
  const replaced = applyGlossary(src);
  const letters = (replaced.match(/[A-Za-z]/g) || []).length;
  const total = replaced.length || 1;
  if (letters / total > 0.35) return '';
  return replaced;
}
