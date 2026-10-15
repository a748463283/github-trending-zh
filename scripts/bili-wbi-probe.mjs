// 探针：验证 B 站 WBI 签名搜索接口能否匿名调用
import { createHash } from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const mixinKey = (orig) => MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

async function wbiKeys() {
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
  });
  const json = await res.json();
  const { img_url, sub_url } = json.data.wbi_img;
  return {
    imgKey: img_url.slice(img_url.lastIndexOf('/') + 1).split('.')[0],
    subKey: sub_url.slice(sub_url.lastIndexOf('/') + 1).split('.')[0],
    raw: json,
  };
}

function sign(params, imgKey, subKey) {
  const mixin = mixinKey(imgKey + subKey);
  const wts = Math.floor(Date.now() / 1000);
  const all = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map((k) => {
      const v = String(all[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  return { query, w_rid: md5(query + mixin), wts };
}

const keys = await wbiKeys();
console.log('imgKey=%s subKey=%s isLogin=%s', keys.imgKey, keys.subKey, keys.raw.data.isLogin);

const target = process.argv[2] || 'ollama 安装教程';
const { query, w_rid } = sign(
  { search_type: 'video', keyword: target, page: 1, page_size: 5, order: 'totalrank' },
  keys.imgKey,
  keys.subKey,
);

const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}&w_rid=${w_rid}`;
const res = await fetch(url, {
  headers: { 'user-agent': UA, referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(target)}` },
});
const json = await res.json();
console.log('code=%s message=%s', json.code, json.message);
console.log('numResults=', json.data && json.data.numResults);
const list = (json.data && json.data.result) || [];
for (const v of list.slice(0, 5)) {
  console.log('-', JSON.stringify({ bvid: v.bvid, title: v.title, author: v.author, play: v.play, duration: v.duration }));
}
