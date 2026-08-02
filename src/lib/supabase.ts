import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface Analysis {
  id: string
  title: string
  logs: string | null
  metrics: string | null
  stack_trace: string | null
  root_cause: string | null
  category: string | null
  severity: string | null
  confidence: number
  summary: string | null
  recommendations: string[] | null
  evidence: string[] | null
  created_at: string
}

export interface AnalysisInput {
  title: string
  logs: string
  metrics: string
  stack_trace: string
}
