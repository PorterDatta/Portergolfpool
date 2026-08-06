// app/(app)/dashboard/page.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

type Standing = {
  participant_id: string; week1: number; week2: number; week3: number;
  total: number; rank: number;
};
type Participant = { id: string; name: string };
type Week = { id: string; week_number: number; name: string; picks_required: number; status: string };
type Pick = { participant_id: string; week_id: string; golfer_id: string };
type Golfer = { id: string; full_name: string };

const RANK_COLORS = ['bg-yellow-500 text-black', 'bg-slate-300 text-black', 'bg-amber-700 text-white'];

export default function DashboardPage() {
  const supabase = createClient();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [golfers, setGolfers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [announcements, setAnnouncements] = useState<{ id: string; message: string }[]>([]);

  async function loadAll() {
    const [{ data: st }, { data: pa }, { data: wk }, { data: pk }, { data: gf }, { data: an }] =
      await Promise.all([
        supabase.from('standings').select('*').order('rank'),
        supabase.from('participants').select('id,name').order('name'),
        supabase.from('weeks').select('id,week_number,name,picks_required,status').order('week_number'),
        supabase.from('picks').select('participant_id,week_id,golfer_id'),
        supabase.from('golfers').select('id,full_name'),
        supabase.from('announcements').select('id,message').order('created_at', { ascending: false }).limit(3),
      ]);
    setStandings(st ?? []);
    setParticipants(pa ?? []);
    setWeeks(wk ?? []);
    setPicks(pk ?? []);
    setGolfers(Object.fromEntries((gf ?? []).map((g: Golfer) => [g.id, g.full_name])));
    setAnnouncements(an ?? []);
    if (!selected && pa?.length) setSelected(pa[0].id);
  }

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel('dash')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standings' },
        (payload: any) => {
          setFlash((f) => new Set(f).add(payload.new.participant_id));
          setTimeout(() => setFlash((f) => {
            const n = new Set(f); n.delete(payload.new.participant_id); return n;
          }), 1300);
          loadAll();
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? '—';

  const chartData = useMemo(() => {
    return [1, 2, 3].map((wn) => {
      const row: any = { name: `Week ${wn}` };
      standings.slice(0, 6).forEach((s) => {
        const cum = (['week1', 'week2', 'week3'] as const)
          .slice(0, wn).reduce((sum, k) => sum + Number(s[k]), 0);
        row[nameOf(s.participant_id)] = cum;
      });
      return row;
    });
  }, [standings, participants]);

  const picksFor = (pid: string, wid: string) =>
    picks.filter((p) => p.participant_id === pid && p.week_id === wid)
         .map((p) => golfers[p.golfer_id]).filter(Boolean);

  const usedGolfers = (pid: string) =>
    picks.filter((p) => p.participant_id === pid).map((p) => golfers[p.golfer_id]).filter(Boolean);

  return (
    <div className="space-y-6">
      {announcements.length > 0 && (
        <div className="card border-amber-500/40 bg-amber-500/10 p-4">
          <p className="mb-1 text-xs font-bold uppercase text-amber-400">Commissioner</p>
          {announcements.map((a) => (
            <p key={a.id} className="text-sm text-amber-100">📣 {a.message}</p>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-lg font-black">Current Standings</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pb-2">Rank</th><th>Player</th>
                  <th className="text-right">Wk 1</th><th className="text-right">Wk 2</th>
                  <th className="text-right">Wk 3</th><th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <tr key={s.participant_id}
                    className={`table-row ${flash.has(s.participant_id) ? 'animate-pulseUp' : ''}`}>
                    <td className="py-2.5">
                      <span className={`rank-badge ${RANK_COLORS[(s.rank ?? 99) - 1] ?? 'bg-[#1a2333] text-slate-300'}`}>
                        {s.rank ?? '-'}
                      </span>
                    </td>
                    <td className="font-semibold">{nameOf(s.participant_id)}</td>
                    <td className="text-right tabular-nums text-slate-400">{s.week1}</td>
                    <td className="text-right tabular-nums text-slate-400">{s.week2}</td>
                    <td className="text-right tabular-nums text-slate-400">{s.week3}</td>
                    <td className="text-right text-base font-black tabular-nums text-green-400">{s.total}</td>
                  </tr>
                ))}
                {standings.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-500">
                    No standings yet — picks & scores will populate here.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-black">Score Progression</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#23304a" strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke="#7c8db0" fontSize={12} />
              <YAxis stroke="#7c8db0" fontSize={12} />
              <Tooltip contentStyle={{ background: '#131a26', border: '1px solid #23304a', borderRadius: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {standings.slice(0, 6).map((s, i) => (
                <Line key={s.participant_id} type="monotone" dataKey={nameOf(s.participant_id)}
                  stroke={['#22c55e','#eab308','#38bdf8','#f472b6','#a78bfa','#fb923c'][i]}
                  strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black">Weekly Picks</h2>
          <select className="input max-w-xs" value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {selected && (
          <div className="grid gap-4 md:grid-cols-3">
            {weeks.map((w) => {
              const chosen = picksFor(selected, w.id);
              return (
                <div key={w.id} className="rounded-xl border border-[#23304a] bg-[#0e141f] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-bold">{w.name}</p>
                    <span className="stat-pill bg-[#1a2333] text-slate-300">
                      {chosen.length}/{w.picks_required}
                    </span>
                  </div>
                  {chosen.length ? (
                    <ul className="space-y-1 text-sm">
                      {chosen.map((n) => (
                        <li key={n} className="flex items-center gap-2 text-slate-200">
                          <span className="text-green-500">•</span>{n}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm italic text-slate-500">(empty until submitted)</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold uppercase text-slate-400">
              Unavailable golfers (already used)
            </h3>
            <div className="flex flex-wrap gap-2">
              {usedGolfers(selected).length ? (
                usedGolfers(selected).map((n) => (
                  <span key={n} className="stat-pill bg-red-500/15 text-red-300 line-through">
                    {n}
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-500">None yet — every golfer is still available.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
