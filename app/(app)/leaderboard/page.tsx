// app/(app)/leaderboard/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

type Week = { id: string; week_number: number; name: string; status: string };
type Row = {
  golfer_id: string; position: string | null; position_num: number | null;
  today: number | null; total_to_par: number | null; fedex_points: number;
  status: string; full_name: string; headshot_url: string | null;
};
type PickPct = Record<string, number>;

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-500/15 text-green-300',
  finished: 'bg-blue-500/15 text-blue-300',
  cut: 'bg-red-500/15 text-red-300',
  wd: 'bg-orange-500/15 text-orange-300',
  dq: 'bg-red-500/15 text-red-300',
};

function toPar(n: number | null) {
  if (n == null) return '–';
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

export default function LeaderboardPage() {
  const supabase = createClient();
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [week, setWeek] = useState<Week | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [pickPct, setPickPct] = useState<PickPct>({});
  const [updatedAt, setUpdatedAt] = useState<string>('');

  async function loadWeeks() {
    const { data } = await supabase.from('weeks').select('id,week_number,name,status').order('week_number');
    setWeeks(data ?? []);
    setWeek((prev) => prev ?? (data ?? []).find((w: Week) => w.status === 'active') ?? (data ?? [])[0] ?? null);
  }

  async function loadBoard(w: Week) {
    const { data: sc } = await supabase
      .from('golfer_scores')
      .select('golfer_id,position,position_num,today,total_to_par,fedex_points,status,golfers(full_name,headshot_url)')
      .eq('week_id', w.id);

    const mapped: Row[] = (sc ?? []).map((s: any) => ({
      golfer_id: s.golfer_id, position: s.position, position_num: s.position_num,
      today: s.today, total_to_par: s.total_to_par, fedex_points: s.fedex_points,
      status: s.status, full_name: s.golfers?.full_name ?? '—',
      headshot_url: s.golfers?.headshot_url ?? null,
    })).sort((a, b) => (a.position_num ?? 999) - (b.position_num ?? 999));
    setRows(mapped);
    setUpdatedAt(new Date().toLocaleTimeString());

    const [{ count: totalParts }, { data: picks }] = await Promise.all([
      supabase.from('participants').select('*', { count: 'exact', head: true }),
      supabase.from('picks').select('golfer_id').eq('week_id', w.id),
    ]);
    const counts: Record<string, number> = {};
    (picks ?? []).forEach((p: any) => { counts[p.golfer_id] = (counts[p.golfer_id] ?? 0) + 1; });
    const pct: PickPct = {};
    Object.entries(counts).forEach(([g, c]) => {
      pct[g] = totalParts ? Math.round((c / totalParts) * 100) : 0;
    });
    setPickPct(pct);
  }

  useEffect(() => { loadWeeks(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!week) return;
    loadBoard(week);
    const ch = supabase.channel('lb')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'golfer_scores' },
        () => loadBoard(week))
      .subscribe();
    const poll = setInterval(() => loadBoard(week), 90_000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
    // eslint-disable-next-line
  }, [week?.id]);

  const isActive = week?.status === 'active';

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex gap-2">
          {weeks.map((w) => (
            <button key={w.id} onClick={() => setWeek(w)}
              className={`btn ${week?.id === w.id ? 'btn-primary' : 'btn-ghost'}`}>
              {w.name.split(' ')[0]} {w.week_number}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {isActive && <span className="flex items-center gap-1 text-green-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />LIVE
          </span>}
          <span>Updated {updatedAt}</span>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-lg font-black">{week?.name}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pb-2">Pos</th><th>Player</th>
                <th className="text-right">Today</th><th className="text-right">Total</th>
                <th className="text-right">FedEx Pts</th><th className="text-center">Status</th>
                <th className="text-right">Picked&nbsp;%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.golfer_id} className="table-row">
                  <td className="py-2.5 font-bold text-slate-300">{r.position ?? '–'}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <img src={r.headshot_url ?? ''} alt=""
                        className="h-7 w-7 rounded-full bg-[#1a2333] object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                      <span className="font-semibold">{r.full_name}</span>
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{toPar(r.today)}</td>
                  <td className="text-right font-semibold tabular-nums">{toPar(r.total_to_par)}</td>
                  <td className="text-right font-black tabular-nums text-green-400">{r.fedex_points}</td>
                  <td className="text-center">
                    <span className={`stat-pill ${STATUS_STYLE[r.status] ?? 'bg-[#1a2333]'}`}>
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="ml-auto flex w-24 items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-[#1a2333]">
                        <div className="h-full rounded-full bg-green-500"
                          style={{ width: `${pickPct[r.golfer_id] ?? 0}%` }} />
                      </div>
                      <span className="w-8 text-xs tabular-nums text-slate-400">
                        {pickPct[r.golfer_id] ?? 0}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-500">
                  No live data yet for this event.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
