// app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabaseClient';

export const metadata: Metadata = {
  title: 'FedEx Cup Fantasy Pool',
  description: 'Live fantasy pool for the PGA Tour FedEx Cup Playoffs',
};

const NAV = [
  { href: '/dashboard',   label: 'Dashboard' },
  { href: '/draft',       label: 'Make Picks' },
  { href: '/leaderboard', label: 'Live Leaderboard' },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  let isCommish = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single();
    isCommish = profile?.role === 'commissioner';
  }

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans">
        <header className="no-print sticky top-0 z-40 border-b border-[#23304a] bg-[#0b0f17]/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="text-xl">🏌️</span>
              <span className="text-lg font-black tracking-tight">
                FedEx Cup <span className="text-green-500">Pool</span>
              </span>
            </Link>
            {user && (
              <nav className="flex items-center gap-1 text-sm">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href}
                    className="rounded-lg px-3 py-2 font-semibold text-slate-300 hover:bg-[#1a2333] hover:text-white">
                    {n.label}
                  </Link>
                ))}
                {isCommish && (
                  <Link href="/admin"
                    className="rounded-lg px-3 py-2 font-semibold text-amber-400 hover:bg-[#1a2333]">
                    Admin
                  </Link>
                )}
                <form action="/auth/signout" method="post">
                  <button className="ml-2 rounded-lg px-3 py-2 text-slate-400 hover:text-white">
                    Sign out
                  </button>
                </form>
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
