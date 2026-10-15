// 临时诊断脚本：列出快照中出现最多但未收录中文映射的 topics
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPIC_ZH } from '../shared/topics-zh.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public', 'data');
const counts = new Map();

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const payload = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  for (const section of payload.sections) {
    for (const repo of section.repos) {
      for (const t of repo.topics) {
        if (TOPIC_ZH[t.key.toLowerCase()]) continue;
        counts.set(t.key, (counts.get(t.key) || 0) + 1);
      }
    }
  }
}

const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45);
console.log('未收录 topics 出现次数（Top 45）：');
console.log(top.map(([k, v]) => `${k}(${v})`).join(', '));
