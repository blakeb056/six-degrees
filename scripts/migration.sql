-- Six Degrees of Separation — Database Schema
-- Run this in your Supabase SQL editor to set up the tables

-- Core connections table
CREATE TABLE IF NOT EXISTS public.linkedin_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  degree int NOT NULL DEFAULT 1,
  source_connection_id uuid REFERENCES public.linkedin_connections(id),
  name text NOT NULL,
  headline text,
  company text,
  role text,
  profile_url text UNIQUE NOT NULL,
  connected_date date,
  power_score numeric DEFAULT 0,
  seniority_score numeric DEFAULT 0,
  company_prestige_score numeric DEFAULT 0,
  influence_signals jsonb DEFAULT '{}',
  tier text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connections_degree ON public.linkedin_connections(degree);
CREATE INDEX IF NOT EXISTS idx_connections_power_score ON public.linkedin_connections(power_score DESC);
CREATE INDEX IF NOT EXISTS idx_connections_source ON public.linkedin_connections(source_connection_id);
CREATE INDEX IF NOT EXISTS idx_connections_tier ON public.linkedin_connections(tier);

-- Edges table for graph visualization (future: multi-degree relationships)
CREATE TABLE IF NOT EXISTS public.linkedin_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.linkedin_connections(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.linkedin_connections(id) ON DELETE CASCADE,
  degree int NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON public.linkedin_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON public.linkedin_edges(target_id);

-- Research subject (center node)
CREATE TABLE IF NOT EXISTS public.linkedin_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  profile_url text,
  created_at timestamptz DEFAULT now()
);

-- Row Level Security — open for this research tool
ALTER TABLE public.linkedin_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for linkedin_connections" ON public.linkedin_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for linkedin_edges" ON public.linkedin_edges FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for linkedin_subjects" ON public.linkedin_subjects FOR ALL USING (true) WITH CHECK (true);

-- Grant access to the anon role (needed for Supabase REST API)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_connections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_edges TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_subjects TO anon;
