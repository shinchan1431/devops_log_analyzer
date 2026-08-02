/*
# Create analyses table for AI DevOps Engineer

1. New Tables
- `analyses`
  - `id` (uuid, primary key)
  - `title` (text, short label for the incident)
  - `logs` (text, raw log input)
  - `metrics` (text, raw metrics input)
  - `stack_trace` (text, raw stack trace input)
  - `root_cause` (text, the detected root cause statement)
  - `category` (text, classification e.g. memory_leak, db_timeout)
  - `severity` (text, critical/warning/info)
  - `confidence` (integer, 0-100)
  - `summary` (text, AI-generated narrative summary)
  - `recommendations` (jsonb, list of suggested fixes)
  - `evidence` (jsonb, supporting evidence snippets)
  - `created_at` (timestamptz)
2. Security
- Enable RLS on `analyses`.
- Single-tenant no-auth app: allow anon + authenticated full CRUD (data intentionally shared).
*/

CREATE TABLE IF NOT EXISTS analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Untitled Incident',
  logs text,
  metrics text,
  stack_trace text,
  root_cause text,
  category text,
  severity text,
  confidence integer DEFAULT 0,
  summary text,
  recommendations jsonb DEFAULT '[]'::jsonb,
  evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_analyses" ON analyses;
CREATE POLICY "anon_select_analyses" ON analyses FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_analyses" ON analyses;
CREATE POLICY "anon_insert_analyses" ON analyses FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_analyses" ON analyses;
CREATE POLICY "anon_update_analyses" ON analyses FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_analyses" ON analyses;
CREATE POLICY "anon_delete_analyses" ON analyses FOR DELETE
  TO anon, authenticated USING (true);
