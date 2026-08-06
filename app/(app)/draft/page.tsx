// app/(app)/draft/page.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

type Week = { id: string; week_number: number; name: string; picks_required: number; status: string; lock_at: string | null };
type Golfer = { id: string; full_name: string; country: string | null; headshot_url: string | null; world_rank: number | null; fedex_rank: number | null };
type Pick = { id: string; participant_id: string; week_id: string; golfer_id: string };
type Score = { golfer_id: string; position: string | null };

export default function DraftPage() {
  const supabase = createClient();
  const [me, setMe] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [activeWeek, setActiveWeek] = useState<Week | null>(null);
  const [golfers, setGolfers] = useState<Golfer[]>([]);
  const [myPicks, setMyPicks] = useState<Pick[]>([]);
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: part } = await supabase
      .from('participants').select('id').eq('profile_id', user.id).single();
    const pid = part?.id ?? null;
    setMe(pid);

    const [{ data: wk }, { data: gf }, { data: sc }] = await Promise.all([
      supabase.from('weeks').select('*').order('week_number'),
      supabase.from('golfers').select('id,full_name,country,headshot_url,world_rank,fedex_rank').order('fedex_rank', { nullsFirst: false }),
      supabase.from('golfer_scores').select('golfer_id,position'),
    ]);
    setWeeks(wk ?? []);
    setGolfers(gf ?? []);
    setPositions(Object.fromEntries((sc ?? []).map((s: Score) => [s.golfer_id, s.position ?? ''])));

    const firstOpen = (wk ?? []).find((w: Week) => w.status !== 'locked' && w.status !== 'completed')
      ?? (wk ?? [])[0] ?? null;
    setActiveWeek((prev) => prev ?? firstOpen);

    if (pid) {
      const { data: pk } = await supabase.from('picks').select('*').eq('participant_id', pid);
      setMyPicks(pk ?? []);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const usedGolferIds = useMemo(() => new Set(myPicks.map((p) => p.golfer_id)), [myPicks]);
  const weekPicks = useMemo(
    () => myPicks.filter((p) => p.week_id === activeWeek?.id),
    [myPicks, activeWeek]
  );

  const locked = activeWeek ? ['locked', 'completed'].includes(activeWeek.status) : true;
  const full = activeWeek ? weekPicks.length >= activeWeek.picks_required : true;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return golfers
      .filter((g) => !q || g.full_name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [golfers, query]);

  async function pick(g: Golfer) {
    if (!me || !activeWeek) return;
    setMsg(null);
    if (locked) return setMsg({ kind: 'err', text: 'This week is locked.' });
    if (usedGolferIds.has(g.id))
      return setMsg({ kind: 'err', text: `You already used ${g.full_name} this season.` });
    if (full)
      return setMsg({ kind: 'err', text: `Week is full (${activeWeek.picks_required} max).` });

    const { error } = await supabase.from('picks').insert({
      participant_id: me, week_id: activeWeek.id, golfer_id: g.id,
    });
    if (error) return setMsg({ kind: 'err', text: error.message });
    setMsg({ kind: 'ok', text: `Added ${g.full_name}` });
    load();
  }

  async function undo(pickId: string) {
    if (locked) return;
    await supabase.from('picks').delete().eq('id', pickId);
    load();
  }

  function countdown(w: Week | null) {
    if (!w?.lock_at) return null;
    const diff = new Date(w.lock_at).getTime() - now;
    if (diff <= 0) return 'Locked';
    const h = Math.floor(diff / 3.6e6);
    const m = Math.floor((diff % 3.6e6) / 6e4);
    const s = Math.floor((diff % 6e4) / 1000);
    return `${h}h ${m}m ${s}s`;
  }

  if (!me) {
    return <div className="card p-8 text-center text-slate-400">
      You are not enrolled in the pool yet. Ask the commissioner to add you.
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2">
            {weeks.map((w) => (
              <button key={w.id} onClick={() => { setActiveWeek(w); setQuery(''); }}
                className={`btn ${activeWeek?.id === w.id ? 'btn-primary' : 'btn-ghost'}`}>
                Week {w.week_number}
              </button>
            ))}
          </div>
          {activeWeek?.lock_at && (
            <div className="text-right">
              <p className="text-xs uppercase text-slate-400">Picks lock in</p>
              <p className="font-mono text-lg font-bold text-amber-400">{countdown(activeWeek)}</p>
            </div>
          )}
        </div>

        {activeWeek && (
          <div className="mt-4 flex items-center justify-between">
            <h2 className="text-lg font-black">{activeWeek.name}</h2>
            <span className={`stat-pill ${full ? 'bg-green-500/20 text-green-300' : 'bg-[#1a2333] text-slate-300'}`}>
              {weekPicks.length} / {activeWeek.picks_required} selected
            </span>
          </div>
        )}
        {locked && (
          <p className="mt-2 text-sm text-red-400">🔒 Picks for this week are locked.</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <input className="input mb-4" placeholder="Search golfers…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {msg && (
            <p className={`mb-3 text-sm ${msg.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {msg.text}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered.map((g) => {
              const used = usedGolferIds.has(g.id);
              const disabled = used || full || locked;
              return (
                <button key={g.id} onClick={() => pick(g)} disabled={disabled}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition
                    ${disabled ? 'cursor-not-allowed border-[#1c2740] opacity-45'
                               : 'border-[#23304a] hover:border-green-500 hover:bg-[#16221a]'}`}>
                  <img src={g.headshot_url ?? '/golfer.png'} alt=""
                    className="h-10 w-10 rounded-full bg-[#1a2333] object-cover"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{g.full_name}</p>
                    <p className="text-xs text-slate-400">
                      {g.country ?? ''} · OWGR {g.world_rank ?? '–'} · FedEx #{g.fedex_rank ?? '–'}
                      {positions[g.id] ? ` · ${positions[g.id]}` : ''}
                    </p>
                  </div>
                  {used
                    ? <span className="stat-pill bg-red-500/15 text-red-300">Used</span>
                    : <span className="text-green-500">＋</span>}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-2 py-6 text-center text-slate-500">No golfers found.</p>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-lg font-black">
            My Week {activeWeek?.week_number} Roster
          </h3>
          <div className="space-y-2">
            {weekPicks.map((p) => {
              const g = golfers.find((x) => x.id === p.golfer_id);
              return (
                <div key={p.id}
                  className="flex items-center justify-between rounded-xl border border-[#23304a] bg-[#0e141f] p-3">
                  <span className="font-semibold">{g?.full_name ?? '—'}</span>
                  {!locked && (
                    <button onClick={() => undo(p.id)}
                      className="text-xs font-semibold text-red-400 hover:text-red-300">
                      Undo
                    </button>
                  )}
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, (activeWeek?.picks_required ?? 0) - weekPicks.length) }).map((_, i) => (
              <div key={i} className="rounded-xl border border-dashed border-[#23304a] p-3 text-sm text-slate-600">
                Empty slot
              </div>
            ))}
          </div>
          {full && !locked && (
            <p className="mt-3 text-sm text-green-400">✅ Week complete — all picks in!</p>
          )}
        </div>
      </div>
    </div>
  );
}
