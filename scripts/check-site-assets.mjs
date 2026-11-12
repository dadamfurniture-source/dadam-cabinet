#!/usr/bin/env node
// ============================================================
// 정적 사이트 자산 확인 — CI 「Build」 잡이 돌린다.
//
// 사이트는 빌드 단계가 없다. GitHub Pages 가 저장소 루트의 파일을 그대로 싣는다.
// 그래서 「빌드가 된다」 대신 「싣는 페이지가 부르는 로컬 파일이 모두 있다」를 확인한다.
//
//   대상 페이지: 루트 *.html, admin/*.html, segan/*.html
//   대상 참조:   <script src>, <link rel="stylesheet|modulepreload|preload|icon|manifest" href>,
//               매니페스트(*.webmanifest) 안의 icons[].src
//   건너뜀:      외부 주소(http:, https:, //), data:, 템플릿 문자열이 섞인 값, HTML 주석 안
//
// 빠진 파일이 하나라도 있으면 목록을 찍고 exit 1.
//
// 쓰는 법: node scripts/check-site-assets.mjs
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_DIRS = ['.', 'admin', 'segan'];
const LINK_RELS = new Set([
  'stylesheet',
  'modulepreload',
  'preload',
  'icon',
  'shortcut',
  'manifest',
  'apple-touch-icon',
]);

function pages() {
  const out = [];
  for (const dir of PAGE_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.html')) out.push(path.join(abs, name));
    }
  }
  return out.sort();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function refs(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  for (const m of body.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    if (src) found.push(src);
  }
  for (const m of body.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') || '').toLowerCase().split(/\s+/);
    const href = attr(m[0], 'href');
    if (href && rel.some((r) => LINK_RELS.has(r))) found.push(href);
  }
  return found;
}

function isLocal(ref) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return false; // http:, https:, data:, //cdn
  if (/\$\{|\{\{|['"+]/.test(ref)) return false; // 스크립트가 조립하는 값
  return ref.trim() !== '' && !ref.startsWith('#');
}

const missing = [];
let checked = 0;

for (const page of pages()) {
  const html = fs.readFileSync(page, 'utf8');
  for (const ref of refs(html)) {
    if (!isLocal(ref)) continue;
    const clean = decodeURI(ref.split(/[?#]/)[0]);
    const target = clean.startsWith('/')
      ? path.join(ROOT, clean)
      : path.join(path.dirname(page), clean);
    checked++;
    if (!fs.existsSync(target)) {
      missing.push(`${path.relative(ROOT, page)} → ${ref}`);
      continue;
    }
    // 웹 앱 매니페스트면 안의 아이콘 파일도 확인한다 (설치 아이콘이 빠지면 홈 화면에 빈 칸이 뜬다)
    if (target.endsWith('.webmanifest')) {
      for (const icon of JSON.parse(fs.readFileSync(target, 'utf8')).icons || []) {
        if (!isLocal(icon.src)) continue;
        const iconPath = decodeURI(icon.src.split(/[?#]/)[0]);
        const iconTarget = iconPath.startsWith('/')
          ? path.join(ROOT, iconPath)
          : path.join(path.dirname(target), iconPath);
        checked++;
        if (!fs.existsSync(iconTarget))
          missing.push(`${path.relative(ROOT, target)} → ${icon.src}`);
      }
    }
  }
}

if (missing.length) {
  console.error(`site assets: 빠진 파일 ${missing.length}개 (확인 ${checked}개)`);
  for (const line of missing) console.error(`  ✗ ${line}`);
  process.exit(1);
}

console.log(`site assets: ${pages().length}개 페이지 · 로컬 참조 ${checked}개 모두 있음`);
