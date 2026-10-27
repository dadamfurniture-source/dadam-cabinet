#!/usr/bin/env node
// ============================================================
// 사이트 자산 버전 하나로 맞추기 — 로컬 css·js·이미지 참조의 ?v= 를 한 값으로 찍는다.
//
// 사이트는 빌드 단계가 없다. GitHub Pages 가 저장소 파일을 그대로 싣고 Cloudflare 가
// 그 앞에서 캐시한다. 그래서 캐시를 깨는 ?v= 값도 저장소에 커밋돼 있어야 한다.
// 값이 페이지·파일마다 따로 놀면 한 페이지만 옛 파일을 캐시에서 꺼내는 반쪽 배포가 생긴다.
//
//   정본:   scripts/asset-version.json 의 "version" 한 곳
//   형식:   YYYYMMDDNN (한국 날짜 + 그날 몇 번째인지 두 자리) 예) 2026102701
//           숫자만이라 크기 비교가 되고, 같은 날 여러 번 올려도 계속 커진다.
//   대상:   루트 *.html, admin/*.html, segan/*.html, segan/sw.js · shell.js 안의
//           따옴표로 감싼 URL(src= · href= 값, 인라인 스크립트 문자열) 중
//           로컬 자산(.js .css 이미지 등, 외부 주소·data:·스크립트가 조립하는 값 제외)에
//           이미 ?v= (또는 &v=) 가 붙은 것. 경로는 건드리지 않고 v 값만 바꾼다.
//           ?v= 가 없는 참조에는 새로 붙이지 않는다.
//           그리고 `const ASSET_VERSION = '…'` 상수 (segan/sw.js 의 캐시 이름이 이 값을 쓴다).
//   검사:   __tests__/asset-version.test.js (CI 「Run Tests」) 가 어긋난 값을 막는다.
//
// ── 버전 올리기 (한 줄) ─────────────────────────────────────
//   npm run asset-version
//     → 오늘(한국 시간) 첫 판이면 YYYYMMDD01, 이미 오늘 판이면 끝 두 자리 +1.
//       asset-version.json 을 고치고 모든 대상 파일의 ?v= 를 새 값으로 찍는다. 그대로 커밋한다.
//
// 그 밖의 쓰는 법:
//   npm run asset-version -- 2026110301   값을 직접 정한다 (지금 값보다 커야 한다)
//   npm run asset-version -- --stamp      값은 그대로 두고 다시 찍기만 (새 페이지에 ?v= 를 붙인 뒤)
//   npm run asset-version -- --check      아무것도 고치지 않고 어긋난 참조만 찍는다 (있으면 exit 1)
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = path.join(ROOT, 'scripts/asset-version.json');
const PAGE_DIRS = ['.', 'admin', 'segan'];
const EXTRA_FILES = ['segan/sw.js', 'segan/shell.js'];

const VERSION_RE = /^\d{8}\d{2}$/;
// 버전을 붙여 싣는 정적 자산 확장자. 페이지 링크(*.html)·API 경로는 건드리지 않는다.
const ASSET_EXT_RE =
  /\.(?:m?js|css|png|jpe?g|webp|avif|gif|svg|ico|json|webmanifest|woff2?|ttf|otf)$/i;
// 따옴표 안의, 공백 없는 값 중 v 파라미터가 있는 것 (src="…" · href='…' · 인라인 스크립트 문자열)
const QUOTED_V_RE = /(["'])([^"'\s<>]*[?&]v=[^"'\s<>]*)\1/g;
// URL 안의 v 파라미터
const V_PARAM_RE = /([?&]v=)([^&#]*)/;
// 스크립트 안의 버전 상수
const CONST_RE = /(\bconst ASSET_VERSION = )(["'])([^"']*)\2/g;

export function readVersion() {
  const { version } = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  if (!VERSION_RE.test(version)) {
    throw new Error(`asset-version.json 의 version 이 YYYYMMDDNN 형식이 아니다: ${version}`);
  }
  return version;
}

/** 대상 파일 목록 (저장소 기준 상대 경로, 정렬) */
export function targetFiles() {
  const out = [];
  for (const dir of PAGE_DIRS) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (name.endsWith('.html')) out.push(path.posix.join(dir === '.' ? '' : dir, name));
    }
  }
  for (const rel of EXTRA_FILES) if (fs.existsSync(path.join(ROOT, rel))) out.push(rel);
  return out.sort();
}

/** 이 저장소의 파일을 가리키는 값인가 (check-site-assets.mjs 와 같은 기준 + 자산 확장자) */
function isLocalAsset(url) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return false; // http:, https:, data:, //cdn
  if (/\$\{|\{\{|[`+]/.test(url)) return false; // 스크립트가 조립하는 값
  const bare = url.split(/[?#]/)[0];
  return bare !== '' && ASSET_EXT_RE.test(bare);
}

/**
 * 한 파일 내용에서 로컬 자산의 v 값을 version 으로 바꾼다.
 * @returns {{ text: string, refs: Array<{ url: string, from: string }> }} refs = 바뀐(어긋났던) 참조
 */
export function stampText(text, version) {
  const refs = [];
  const out = text
    .replace(QUOTED_V_RE, (whole, quote, url) => {
      if (!isLocalAsset(url)) return whole;
      const m = url.match(V_PARAM_RE);
      if (m[2] === version) return whole;
      refs.push({ url, from: m[2] });
      return `${quote}${url.replace(V_PARAM_RE, `$1${version}`)}${quote}`;
    })
    .replace(CONST_RE, (whole, lead, quote, value) => {
      if (value === version) return whole;
      refs.push({ url: 'const ASSET_VERSION', from: value });
      return `${lead}${quote}${version}${quote}`;
    });
  return { text: out, refs };
}

/** 한국 날짜 기준 다음 버전. 오늘 판이 이미 있으면 끝 두 자리를 올린다. */
export function nextVersion(current, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replace(/-/g, '');
  const first = `${today}01`;
  if (Number(first) > Number(current)) return first;
  const seq = Number(current.slice(8)) + 1;
  if (seq > 99) throw new Error(`하루에 99번을 넘겨 올릴 수 없다: ${current}`);
  return `${current.slice(0, 8)}${String(seq).padStart(2, '0')}`;
}

function main(argv) {
  const args = argv.slice(2);
  const check = args.includes('--check');
  const stampOnly = args.includes('--stamp');
  const explicit = args.find((a) => !a.startsWith('--'));

  const current = readVersion();
  let version = current;
  if (!check && !stampOnly) {
    if (explicit) {
      if (!VERSION_RE.test(explicit)) throw new Error(`YYYYMMDDNN 형식이 아니다: ${explicit}`);
      if (Number(explicit) <= Number(current)) {
        throw new Error(
          `새 값(${explicit})이 지금 값(${current})보다 커야 한다 — 캐시가 옛 파일을 계속 준다`
        );
      }
      version = explicit;
    } else {
      version = nextVersion(current);
    }
  }

  let drift = 0;
  let changedFiles = 0;
  for (const rel of targetFiles()) {
    const abs = path.join(ROOT, rel);
    const before = fs.readFileSync(abs, 'utf8');
    const { text, refs } = stampText(before, version);
    if (!refs.length) continue;
    drift += refs.length;
    if (check) {
      for (const r of refs) console.error(`  ✗ ${rel} → ${r.url} (기대 v=${version})`);
      continue;
    }
    fs.writeFileSync(abs, text);
    changedFiles++;
  }

  if (check) {
    if (drift) {
      console.error(`asset version: 어긋난 참조 ${drift}개 — npm run asset-version -- --stamp`);
      process.exit(1);
    }
    console.log(`asset version: ${version} — 모든 로컬 ?v= 참조가 같다`);
    return;
  }

  if (version !== current) {
    fs.writeFileSync(VERSION_FILE, `${JSON.stringify({ version }, null, 2)}\n`);
  }
  console.log(
    `asset version: ${current === version ? version : `${current} → ${version}`} · 파일 ${changedFiles}개 · 참조 ${drift}개 고침`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
