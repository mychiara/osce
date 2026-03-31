-- ================================================================
-- SUPABASE SCHEMA UNTUK APLIKASI OSCE
-- Jalankan SQL ini di Supabase SQL Editor
-- ================================================================

-- 1. Tabel Peserta
CREATE TABLE IF NOT EXISTS peserta (
    id BIGINT PRIMARY KEY,
    nim TEXT NOT NULL UNIQUE,
    nama TEXT NOT NULL,
    password TEXT,
    sesi INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel Penguji
CREATE TABLE IF NOT EXISTS penguji (
    id BIGINT PRIMARY KEY,
    "idPenguji" TEXT NOT NULL UNIQUE,
    nama TEXT NOT NULL,
    "assignedStationId" BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabel Stations (rubric disimpan sebagai JSONB)
CREATE TABLE IF NOT EXISTS stations (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    "maxTime" INTEGER DEFAULT 0,
    "passingGrade" INTEGER DEFAULT 75,
    soal TEXT,
    rubric JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabel Scores (scores detail disimpan sebagai JSONB)
CREATE TABLE IF NOT EXISTS scores (
    id BIGINT PRIMARY KEY,
    "pengujiId" BIGINT NOT NULL,
    "pesertaId" BIGINT NOT NULL,
    "stationId" BIGINT NOT NULL,
    scores JSONB DEFAULT '[]'::jsonb,
    komentar TEXT,
    "globalPerformance" INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabel Credentials (untuk login)
CREATE TABLE IF NOT EXISTS credentials (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'penguji',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabel Config (key-value store untuk scheduleParams, certSettings, dll)
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabel Feedback
CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    "pesertaId" BIGINT NOT NULL,
    "submittedAt" TIMESTAMPTZ DEFAULT NOW(),
    "feedbackItems" JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- INSERT DEFAULT DATA
-- ================================================================

-- Default admin credentials
INSERT INTO credentials (username, password, role)
VALUES ('admin', 'admin123', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Default config entries
INSERT INTO config (key, value)
VALUES 
    ('scheduleParams', '{}'::jsonb),
    ('certSettings', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ================================================================
-- ROW LEVEL SECURITY (RLS) - Disable for simplicity
-- Enable anon access for the app
-- ================================================================

ALTER TABLE peserta ENABLE ROW LEVEL SECURITY;
ALTER TABLE penguji ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Allow full public access (anon key) for all tables
-- In production, you should restrict this!

CREATE POLICY "Allow all for peserta" ON peserta FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for penguji" ON penguji FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for stations" ON stations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for scores" ON scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for credentials" ON credentials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for config" ON config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for feedback" ON feedback FOR ALL USING (true) WITH CHECK (true);
