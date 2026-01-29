-- ============================================================
-- 채팅 메시지 저장 테이블
-- AI 설계사 대화 기록 저장용 (v1.0)
-- ============================================================

-- 채팅 메시지 테이블
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,

  -- 세션 정보 (비로그인 사용자를 위한 세션 ID)
  session_id TEXT,

  -- 메시지 내용
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,

  -- 메타데이터
  page_source TEXT DEFAULT 'ai-design',  -- 어느 페이지에서 발생한 대화인지
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- RLS (Row Level Security) 활성화
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 로그인 사용자는 자신의 메시지만 조회/생성 가능
CREATE POLICY "Users can view own chat messages" ON chat_messages
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chat messages" ON chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 비로그인 사용자를 위한 정책 (세션 기반)
CREATE POLICY "Anonymous users can view session messages" ON chat_messages
  FOR SELECT USING (user_id IS NULL AND session_id IS NOT NULL);

CREATE POLICY "Anonymous users can insert session messages" ON chat_messages
  FOR INSERT WITH CHECK (user_id IS NULL AND session_id IS NOT NULL);
