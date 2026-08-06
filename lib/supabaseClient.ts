// lib/supabaseClient.ts
// Browser and server-side Supabase clients (App Router friendly).
import { createBrowserClient, createServerClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Use inside client components / hooks.
export function createClient() {
  return createBrowserClient(url, anon);
}

// Use inside server components, route handlers, and server actions.
export function createServerSupabase() {
  // Lazy-load next/headers so this file is safe to import from client components.
  const { cookies } = require('next/headers');
  const cookieStore = cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // called from a Server Component — safe to ignore
        }
      },
    },
  });
}