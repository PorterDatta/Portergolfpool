// app/api/sync-scores/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchLiveField } from '@/lib/golf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: activeWeeks, error: weekErr } = await supabaseAdmin
    .from('weeks')
    .select('id, season_id, name')
    .eq('status', 'active');

  if (weekErr) return NextResponse.json({ error: weekErr.message }, { status: 500 });
  if (!activeWeeks?.length) {
    return NextResponse.json({ ok: true, message: 'no active weeks' });
  }

  const field = await fetchLiveField();
  if (!field.length) {
    return NextResponse.json({ ok: true, message: 'no live data yet' });
  }

  const touchedSeasons = new Set<string>();

  for (const week of activeWeeks) {
    touchedSeasons.add(week.season_id);

    for (const g of field) {
      const { data: golfer } = await supabaseAdmin
        .from('golfers')
        .upsert(
          {
            external_id: g.externalId,
            full_name: g.fullName,
            country: g.country ?? null,
            headshot_url: g.headshotUrl ?? null,
            world_rank: g.worldRank ?? null,
            fedex_rank: g.fedexRank ?? null,
          },
          { onConflict: 'external_id' }
        )
        .select('id')
        .single();

      if (!golfer) continue;

      await supabaseAdmin.from('golfer_scores').upsert(
        {
          week_id: week.id,
          golfer_id: golfer.id,
          position: g.position ?? null,
          position_num: g.positionNum ?? null,
          today: g.today ?? null,
          total_to_par: g.totalToPar ?? null,
          fedex_points: g.fedexPoints,
          status: g.status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'week_id,golfer_id' }
      );
    }
  }

  for (const seasonId of touchedSeasons) {
    await supabaseAdmin.rpc('recompute_standings', { p_season_id: seasonId });
  }

  return NextResponse.json({
    ok: true,
    weeks: activeWeeks.length,
    golfers: field.length,
    updated_at: new Date().toISOString(),
  });
}
