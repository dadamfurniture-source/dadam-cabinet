/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 가전 모델 제품 사진 — database/appliance-models-images.sql (2026-10-20 사장님 결정 "모델 사진 = (b)").
 *   - 두 번 실행해도 안전 · 파괴 문장 없음
 *   - 칸 넷 · 버킷 appliance-images 공개 읽기 · 쓰기는 관리자(is_admin) 만
 *   - 가져오기 함수는 niche 판과 같고 image_source_url 만 더한다 (image_path 는 건드리지 않는다)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const SQL = read('database/appliance-models-images.sql');
const NICHE = read('database/appliance-models-niche.sql');
const body = SQL.replace(/--[^\n]*/g, '');

const fnBody = (src) => {
  const s = src.indexOf('CREATE OR REPLACE FUNCTION import_appliance_models');
  return src.slice(s, src.indexOf('$$;', s));
};

describe('appliance-models-images.sql', () => {
  test('칸 넷은 IF NOT EXISTS', () => {
    for (const col of ['image_source_url', 'image_path', 'image_approved_at', 'image_approved_by']) {
      expect(SQL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  test('파괴 문장이 없다 — DROP TABLE · TRUNCATE · DELETE FROM · DROP COLUMN', () => {
    expect(body).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  test('제약·정책은 DROP … IF EXISTS 뒤 다시 만든다', () => {
    for (const m of body.matchAll(/ADD CONSTRAINT (\w+)/g)) {
      expect(body).toContain(`DROP CONSTRAINT IF EXISTS ${m[1]}`);
    }
    for (const m of body.matchAll(/CREATE POLICY "(\w+)"/g)) {
      expect(body).toContain(`DROP POLICY IF EXISTS "${m[1]}"`);
    }
  });

  test('버킷 appliance-images 공개 읽기 · 쓰기 정책은 모두 is_admin()', () => {
    expect(SQL).toContain("VALUES ('appliance-images', 'appliance-images', TRUE)");
    expect(SQL).toMatch(/"appliance_images_obj_read"[\s\S]*?USING \(bucket_id = 'appliance-images'\);/);
    for (const p of ['insert', 'update', 'delete']) {
      const s = SQL.indexOf(`CREATE POLICY "appliance_images_obj_${p}"`);
      const stmt = SQL.slice(s, SQL.indexOf(';', s));
      expect(stmt).toContain('TO authenticated');
      expect(stmt).toContain('public.is_admin()');
    }
  });

  test('image_path 에 외부 링크·절대 경로·.. 를 못 넣는다', () => {
    expect(SQL).toContain("image_path !~ '^[a-z]+:'");
    expect(SQL).toContain("image_path !~ '^/'");
  });

  test('가져오기 함수 = niche 판 + image_source_url 만 (image_path 는 건드리지 않는다)', () => {
    const a = fnBody(SQL);
    const b = fnBody(NICHE);
    expect(a).toContain("NULLIF(r->>'image_source_url', '')");
    expect(a).toContain("image_source_url = COALESCE(NULLIF(r->>'image_source_url', ''), image_source_url)");
    expect(a).not.toMatch(/image_path\s*=/);
    // image_source_url 줄을 빼면 niche 판과 같다 (공백 차이 무시)
    const norm = (s) => s
      .replace(/,\s*image_source_url(?=,)/, '')
      .replace(/, NULLIF\(r->>'image_source_url', ''\)/, '')
      .replace(/\n\s*image_source_url = [^\n]*/, '')
      .replace(/\s+/g, ' ');
    expect(norm(a)).toBe(b.replace(/\s+/g, ' '));
  });

  test('웹 · 익명은 가져오기 함수를 못 부른다', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM PUBLIC;');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;');
  });
});
