// lib/supabaseAdmin.ts
// SERVER ONLY. Bypasses RLS for cron/score-sync and exports.
// Never import this into a client component.
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
