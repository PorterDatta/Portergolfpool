// app/api/sync-scores/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchLiveField } from '@/lib/golf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const urlKey = req.nextUrl.searchParams.get('key');
  const ok =
    !process.env.CRON_SECRET ||
    auth === `Bearer ${process.env.CRON_SECRET}` ||
    urlKey === process.env.CRON_SECRET;
  if (!ok) {
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

  // 1) Batch-upsert ALL golfers at once
  const { error: gErr } = await supabaseAdmin.from('golfers').upsert(
    field.map((g) => ({
      external_id: g.externalId,
      full_name: g.fullName,
      country: g.country ?? null,
      headshot_url: g.headshotUrl ?? null,
      world_rank: g.worldRank ?? null,
      fedex_rank: g.fedexRank ?? null,
    })),
    { onConflict: 'external_id' }
  );
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });

  // 2) Fetch their ids in one query
  const externalIds = field.map((g) => g.externalId);
  const { data: golferRows } = await supabaseAdmin
    .from('golfers')
    .select('id, external_id')
    .in('external_id', externalIds);

  const idByExternal = new Map(
    (golferRows ?? []).map((r: any) => [r.external_id, r.id])
  );

  // 3) Batch-upsert scores for every active week
  const touchedSeasons = new Set<string>();
  for (const week of activeWeeks) {
    touchedSeasons.add(week.season_id);

    const scoreRows = field
      .map((g) => {
        const gid = idByExternal.get(g.externalId);
        if (!gid) return null;
        return {
          week_id: week.id,
          golfer_id: gid,
          position: g.position ?? null,
          position_num: g.positionNum ?? null,
          today: g.today ?? null,
          total_to_par: g.totalToPar ?? null,
          fedex_points: g.fedexPoints,
          status: g.status,
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    await supabaseAdmin
      .from('golfer_scores')
      .upsert(scoreRows as any[], { onConflict: 'week_id,golfer_id' });
  }

  // 4) Recompute standings for touched seasons
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