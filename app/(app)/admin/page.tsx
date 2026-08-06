// app/(app)/admin/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

type Week = { id: string; week_number: number; name: string; status: string; picks_required: number; weight: number; lock_at: string | null };
type Participant = { id: string; name: string; profile_id: string | null };
type Profile = { id: string; email: string; display_name: string };

export default function AdminPage() {
  const supabase = createClient();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [csv, setCsv] = useState('');
  const [announce, setAnnounce] = useState('');
  const [toast, setToast] = useState('');

  function flash(t: string) { setToast(t); setTimeout(() => setToast(''), 2500); }

  async function load() {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).order('created_at', { ascending: false }).limit(1).single();
    setSeasonId(season?.id ?? null);
    const [{ data: wk }, { data: pa }, { data: pr }] = await Promise.all([
      supabase.from('weeks').select('*').order('week_number'),
      supabase.from('participants').select('id,name,profile_id').order('name'),
      supabase.from('profiles').select('id,email,display_name').order('display_name'),
    ]);
    setWeeks(wk ?? []);
    setParticipants(pa ?? []);
    setProfiles(pr ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function log(action: string, detail: any) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({ actor: user?.id, action, detail });
  }

  async function setWeekStatus(w: Week, status: string) {
    await supabase.from('weeks').update({ status }).eq('id', w.id);
    await log('week_status', { week: w.week_number, status });
    flash(`${w.name} → ${status}`); load();
  }

  async function setLockTime(w: Week, iso: string) {
    await supabase.from('weeks').update({ lock_at: iso || null }).eq('id', w.id);
    flash('Lock time saved'); load();
  }

  async function setWeight(w: Week, weight: number) {
    await supabase.from('weeks').update({ weight }).eq('id', w.id);
    if (seasonId) await supabase.rpc('recompute_standings', { p_season_id: seasonId });
    flash('Scoring weight updated'); load();
  }

  async function addParticipant(profileId: string | null, name: string) {
    if (!seasonId || !name.trim()) return;
    await supabase.from('participants').insert({ season_id: seasonId, name: name.trim(), profile_id: profileId });
    await log('add_participant', { name });
    flash(`Added ${name}`); load();
  }

  async function removeParticipant(p: Participant) {
    if (!confirm(`Remove ${p.name}? Their picks will be deleted.`)) return;
    await supabase.from('participants').delete().eq('id', p.id);
    await log('remove_participant', { name: p.name });
    flash(`Removed ${p.name}`); load();
  }

  async function importCsv() {
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const [name, email] = line.split(',').map((s) => s?.trim());
      const prof = email ? profiles.find((p) => p.email === email) : null;
      await addParticipant(prof?.id ?? null, name);
    }
    setCsv(''); flash(`Imported ${lines.length} participants`);
  }

  async function postAnnouncement() {
    if (!seasonId || !announce.trim()) return;
    await supabase.from('announcements').insert({ season_id: seasonId, message: announce.trim() });
    setAnnounce(''); flash('Announcement posted');
  }

  async function newSeason() {
    const name = prompt('New season name (e.g. FedEx Cup 2027)');
    if (!name) return;
    if (seasonId) await supabase.from('seasons').update({ is_active: false, archived: true }).eq('id', seasonId);
    const { data: s } = await supabase.from('seasons').insert({ name }).select('id').single();
    if (s) {
      await supabase.from('weeks').insert([
        { season_id: s.id, week_number: 1, name: 'FedEx St. Jude Championship', picks_required: 5, status: 'upcoming' },
        { season_id: s.id, week_number: 2, name: 'BMW Championship', picks_required: 4, status: 'upcoming' },
        { season_id: s.id, week_number: 3, name: 'TOUR Championship', picks_required: 3, status: 'upcoming' },
      ]);
    }
    await log('new_season', { name });
    flash('New season created'); load();
  }

  const exportUrl = (type: string) => `/api/export?type=${type}&season=${seasonId}`;

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-600 px-4 py-2 font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      <h1 className="text-2xl font-black">⚙️ Commissioner Panel</h1>

      <section className="card p-5">
        <h2 className="mb-4 text-lg font-black">Weeks & Locking</h2>
        <div className="space-y-3">
          {weeks.map((w) => (
            <div key={w.id} className="grid items-center gap-3 rounded-xl bg-[#0e141f] p-4 md:grid-cols-5">
              <div>
                <p className="font-bold">{w.name}</p>
                <p className="text-xs text-slate-400">{w.picks_required} picks · Week {w.week_number}</p>
              </div>
              <select className="input" value={w.status} onChange={(e) => setWeekStatus(w, e.target.value)}>
                {['upcoming', 'active', 'locked', 'completed'].map((s) => <option key={s}>{s}</option>)}
              </select>
              <input className="input" type="datetime-local"
                defaultValue={w.lock_at ? w.lock_at.slice(0, 16) : ''}
                onBlur={(e) => setLockTime(w, e.target.value ? new Date(e.target.value).toISOString() : '')} />
              <input className="input" type="number" step="0.1" defaultValue={w.weight}
                onBlur={(e) => setWeight(w, Number(e.target.value))} title="Scoring weight" />
              <div className="flex gap-2">
                <button className="btn-ghost flex-1 text-xs" onClick={() => setWeekStatus(w, 'locked')}>Lock</button>
                <button className="btn-ghost flex-1 text-xs" onClick={() => setWeekStatus(w, 'active')}>Unlock</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-lg font-black">Participants ({participants.length})</h2>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <AddParticipant profiles={profiles} onAdd={addParticipant} />
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">CSV import (name,email)</label>
            <textarea className="input h-24" value={csv} onChange={(e) => setCsv(e.target.value)}
              placeholder={'Porter,porter@x.com\nRandy\nNick,nick@x.com'} />
            <button className="btn-primary mt-2 w-full" onClick={importCsv}>Import CSV</button>
          </div>
        </div>
        <ul className="divide-y divide-[#1c2740]">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2.5">
              <span className="font-semibold">{p.name}
                {!p.profile_id && <span className="ml-2 text-xs text-amber-400">(no login linked)</span>}
              </span>
              <button className="text-xs text-red-400 hover:text-red-300" onClick={() => removeParticipant(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-black">Announcement</h2>
          <textarea className="input h-24" value={announce} onChange={(e) => setAnnounce(e.target.value)}
            placeholder="Message shown on everyone's dashboard…" />
          <button className="btn-primary mt-2 w-full" onClick={postAnnouncement}>Post</button>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-black">Exports</h2>
          <div className="space-y-2">
            <a className="btn-ghost w-full" href={exportUrl('standings-xlsx')}>Standings → Excel</a>
            <a className="btn-ghost w-full" href={exportUrl('picks-pdf')}>Picks → PDF</a>
            <a className="btn-ghost w-full" href={exportUrl('participants-csv')}>Participants → CSV</a>
            <button className="btn-ghost w-full" onClick={() => window.print()}>Print standings</button>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-black">Season</h2>
          <p className="mb-3 text-sm text-slate-400">
            Archive the current season and start a fresh one with all three playoff weeks.
          </p>
          <button className="btn-danger w-full" onClick={newSeason}>Start New Season</button>
        </section>
      </div>
    </div>
  );
}

function AddParticipant({ profiles, onAdd }: {
  profiles: Profile[];
  onAdd: (profileId: string | null, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState('');
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Add participant</label>
      <input className="input mb-2" placeholder="Display name" value={name}
        onChange={(e) => setName(e.target.value)} />
      <select className="input mb-2" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
        <option value="">Link a login (optional)…</option>
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name} — {p.email}</option>)}
      </select>
      <button className="btn-primary w-full"
        onClick={() => { onAdd(profileId || null, name); setName(''); setProfileId(''); }}>
        Add
      </button>
    </div>
  );
}
