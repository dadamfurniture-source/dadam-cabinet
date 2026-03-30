-- ═══════════════════════════════════════════════════════════════
-- Collection 소셜 기능 스키마
-- 게시물 + 좋아요 + 문의
-- ═══════════════════════════════════════════════════════════════

-- 게시물
CREATE TABLE IF NOT EXISTS collection_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'kitchen' CHECK (category IN ('kitchen','builtin','storage','interior','other')),
  like_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 좋아요 (유저당 게시물당 1회)
CREATE TABLE IF NOT EXISTS collection_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES collection_posts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);

-- 문의
CREATE TABLE IF NOT EXISTS collection_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID REFERENCES auth.users(id),
  to_user_id UUID REFERENCES auth.users(id) NOT NULL,
  post_id UUID REFERENCES collection_posts(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_collection_posts_user ON collection_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_posts_category ON collection_posts(category);
CREATE INDEX IF NOT EXISTS idx_collection_posts_created ON collection_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_likes_post ON collection_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_collection_likes_user ON collection_likes(user_id);

-- RLS
ALTER TABLE collection_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_inquiries ENABLE ROW LEVEL SECURITY;

-- 게시물: 모두 읽기 가능, 본인만 생성/삭제
CREATE POLICY "collection_posts_select" ON collection_posts FOR SELECT USING (true);
CREATE POLICY "collection_posts_insert" ON collection_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "collection_posts_delete" ON collection_posts FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "collection_posts_update" ON collection_posts FOR UPDATE USING (auth.uid() = user_id);

-- 좋아요: 모두 읽기, 본인만 생성/삭제
CREATE POLICY "collection_likes_select" ON collection_likes FOR SELECT USING (true);
CREATE POLICY "collection_likes_insert" ON collection_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "collection_likes_delete" ON collection_likes FOR DELETE USING (auth.uid() = user_id);

-- 문의: 발신자와 수신자만 읽기, 누구나 생성
CREATE POLICY "collection_inquiries_select" ON collection_inquiries FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
CREATE POLICY "collection_inquiries_insert" ON collection_inquiries FOR INSERT WITH CHECK (true);

-- like_count 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_like_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE collection_posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE collection_posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_like_count
  AFTER INSERT OR DELETE ON collection_likes
  FOR EACH ROW EXECUTE FUNCTION update_like_count();

-- 스토리지 버킷 (수동 생성 필요)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('collection', 'collection', true);
