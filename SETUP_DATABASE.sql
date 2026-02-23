-- ============================================================
--  SUPABASE MIGRATION — Lì Xì Platform v3
--  Chạy script này trong Supabase SQL Editor
-- ============================================================

-- 1. Bảng rooms (mỗi link lì xì = 1 room)
CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT 'Lì Xì Tết 2025',
  host_name     TEXT,
  subtitle      TEXT,
  emoji         TEXT DEFAULT '🧧',
  pass_hash     TEXT,
  is_open       BOOLEAN DEFAULT TRUE,
  envelope_count INT DEFAULT 20,
  opened_count  INT DEFAULT 0,
  config        JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Bảng envelopes (phong bì của mỗi room)
CREATE TABLE IF NOT EXISTS envelopes (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  position      INT NOT NULL,
  display_value INT NOT NULL DEFAULT 10,
  real_value    INT NOT NULL DEFAULT 10,
  is_special    BOOLEAN DEFAULT FALSE,
  opened        BOOLEAN DEFAULT FALSE,
  opened_at     TIMESTAMPTZ,
  opened_by     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Bảng events (lịch sử bốc)
CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  envelope_id   BIGINT REFERENCES envelopes(id),
  display_value INT,
  real_value    INT,
  is_special    BOOLEAN DEFAULT FALSE,
  player_name   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_envelopes_room ON envelopes(room_id);
CREATE INDEX IF NOT EXISTS idx_events_room    ON events(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_open     ON rooms(is_open);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE envelopes;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE events;

-- RLS (Row Level Security) - cho phép anon đọc/ghi
ALTER TABLE rooms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE envelopes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events     ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Allow all rooms"     ON rooms;
DROP POLICY IF EXISTS "Allow all envelopes" ON envelopes;
DROP POLICY IF EXISTS "Allow all events"    ON events;

CREATE POLICY "Allow all rooms"     ON rooms     FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Allow all envelopes" ON envelopes FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Allow all events"    ON events    FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
--  DONE! Database sẵn sàng cho Lì Xì Platform v3
-- ============================================================
