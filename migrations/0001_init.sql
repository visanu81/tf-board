-- 현황판 저장소: 글·질문, 답변·댓글, 단계별 진행 상태
-- 삭제는 deleted_at에 시각만 적는 방식이라, 실수로 지운 글은 되살릴 수 있다.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'question')),
  body TEXT NOT NULL,
  nick TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS posts_live ON posts (deleted_at, created_at);

CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  body TEXT NOT NULL,
  nick TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS replies_post ON replies (post_id, deleted_at);

CREATE TABLE IF NOT EXISTS stage_status (
  stage TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('done', 'current', 'todo')),
  updated_at TEXT NOT NULL
);
