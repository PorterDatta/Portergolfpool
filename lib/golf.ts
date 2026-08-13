// lib/golf.ts
// Live golf data — 100% FREE (ESPN public scoreboard, no API key).
//
// SCORING MODEL: OFFICIAL FEDEX CUP POINTS by finishing position.
// Points are ONLY assigned from a REAL leaderboard position, with proper
// tie-splitting (players tied for a spot split the sum of the slots they
// occupy). Highest total wins.
//
// CRITICAL FIX: before a tournament starts, ESPN reports every player at "E"
// with NO real position (status = "pre"/"scheduled"). In that case we assign
// ZERO points and no position — so the board shows the whole field at E / 0
// instead of a fake leaderboard built from ESPN's listing order.
//
// The FedEx Cup Playoff events have NO CUT — everyone plays 4 rounds — so no
// missed-cut handling is needed. WD/DQ simply earn 0 points.

export interface GolferRow {
  externalId: string;
  fullName: string;
  country?: string;
  headshotUrl?: string;
  worldRank?: number;
  fedexRank?: number;
  position?: string;       // "T4", "1", "WD"  (undefined before play starts)
  positionNum?: number;    // numeric for sorting
  today?: number;          // today score to par
  totalToPar?: number;     // tournament score to par
  fedexPoints: number;     // official FedEx Cup points earned. Higher = better.
  status: 'active' | 'cut' | 'wd' | 'dq' | 'finished';
}

// Official FedEx Cup Playoff points payout by finishing slot (St. Jude / BMW).
// Index 0 = 1st place. Extended to cover a full playoff field.
const PLAYOFF_POINTS: number[] = [
  2000, 1200, 760, 540, 440, 400, 360, 340, 320, 300,   // 1-10
  280, 260, 244, 228, 212, 196, 180, 164, 148, 140,     // 11-20
  132, 124, 116, 108, 100, 96, 92, 88, 84, 80,          // 21-30
  76, 72, 68, 64, 60.8, 57.6, 54.4, 51.2, 48, 44.8,     // 31-40
  41.6, 38.4, 35.2, 32, 29.6, 27.2, 24.8, 22.4, 20.8, 19.2, // 41-50
  18.4, 17.6, 16.8, 16, 15.2, 14.4, 13.6, 12.8, 12.4, 12,   // 51-60
  11.6, 11.2, 10.8, 10.4, 10, 9.6, 9.2, 8.8, 8.4, 8,       // 61-70
];

function parsePosition(p?: string): number | undefined {
  if (!p) return undefined;
  const n = parseInt(p.replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? undefined : n;
}

// Sum the payout for slots [start .. start+count-1], 1-indexed positions.
function slotSum(startPos: number, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += PLAYOFF_POINTS[startPos - 1 + i] ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------
// ESPN (PRIMARY — free, no key)
// ---------------------------------------------------------------------
async function fromESPN(): Promise<GolferRow[] | null> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?_=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const event = data?.events?.[0];
    const comp = event?.competitions?.[0];
    const players = comp?.competitors ?? [];
    if (!players.length) return null;

    // Is the tournament actually underway? ESPN gives a status state:
    // "pre" (scheduled) | "in" (live) | "post" (final). Before "in", there is
    // no real leaderboard — so we must NOT assign positions or points.
    const state: string =
      comp?.status?.type?.state ?? event?.status?.type?.state ?? 'pre';
    const hasStarted = state === 'in' || state === 'post';

    const rows: GolferRow[] = players.map((c: any): GolferRow => {
      const a = c.athlete ?? {};
      // The golfer id lives on the COMPETITOR (c.id). The athlete object
      // often has NO id before the tournament starts — so use c.id first.
      const externalId = String(c.id ?? a.id ?? c.uid ?? a.displayName);

      const desc = (c.status?.type?.description ?? '').toLowerCase();
      const cut = /cut/.test(desc);
      const wd = /withdraw/.test(desc);
      const dq = /disqualif/.test(desc);

      // score can be "E", "-3", "+2", or a number
      const rawScore = c.score;
      let totalToPar: number | undefined;
      if (rawScore === 'E') totalToPar = 0;
      else if (rawScore != null && rawScore !== '') {
        const n = Number(String(rawScore).replace('+', ''));
        totalToPar = Number.isNaN(n) ? undefined : n;
      }

      // Only trust a real position once play has started.
      const posStr = hasStarted
        ? (c.status?.position?.displayName ?? c.status?.position?.id ?? undefined)
        : undefined;
      const posNum = parsePosition(posStr);

      return {
        externalId,
        fullName: a.displayName ?? a.fullName ?? 'Unknown',
        country: a.flag?.alt,
        headshotUrl: a.headshot?.href,
        position: posStr || undefined,
        positionNum: posNum,
        today: Number(c.linescores?.at(-1)?.value) || undefined,
        totalToPar: hasStarted ? totalToPar : 0, // pre-start: everyone at E
        fedexPoints: 0, // filled in below, only when play has started
        status: cut ? 'cut' : wd ? 'wd' : dq ? 'dq'
              : c.status?.type?.completed ? 'finished' : 'active',
      };
    });

    // Before the tournament starts: everyone at E / 0, no points, no board.
    if (!hasStarted) return rows;

    // Play has started — assign points from REAL positions with tie-splitting.
    // Group golfers by their finishing position number.
    const byPos = new Map<number, GolferRow[]>();
    for (const r of rows) {
      if (r.status === 'wd' || r.status === 'dq' || r.status === 'cut') continue;
      if (r.positionNum == null) continue;
      const list = byPos.get(r.positionNum) ?? [];
      list.push(r);
      byPos.set(r.positionNum, list);
    }

    for (const [pos, group] of byPos) {
      // Players tied at `pos` occupy slots pos .. pos+count-1 and split them.
      const shared = slotSum(pos, group.length) / group.length;
      for (const r of group) r.fedexPoints = Math.round(shared * 100) / 100;
    }

    return rows;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// DATAGOLF (OPTIONAL — only if a key is present)
// ---------------------------------------------------------------------
async function fromDataGolf(): Promise<GolferRow[] | null> {
  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://feeds.datagolf.com/preds/in-play?tour=pga&file_format=json&key=${key}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const players = data?.data ?? data?.players ?? [];
    if (!Array.isArray(players) || players.length === 0) return null;

    const rows: GolferRow[] = players.map((p: any): GolferRow => {
      const posNum = parsePosition(String(p.current_pos ?? p.position ?? ''));
      const status =
        /wd/i.test(p.current_pos ?? '') ? 'wd'
        : /dq/i.test(p.current_pos ?? '') ? 'dq'
        : (p.thru === 'F' || p.round === 4) ? 'finished'
        : 'active';
      const points =
        posNum != null && (status === 'active' || status === 'finished')
          ? (PLAYOFF_POINTS[posNum - 1] ?? 0)
          : 0;
      return {
        externalId: String(p.dg_id),
        fullName: p.player_name,
        country: p.country,
        worldRank: p.owgr_rank,
        fedexRank: p.fedex_cup_rank,
        position: p.current_pos ?? p.position,
        positionNum: posNum,
        today: p.today,
        totalToPar: p.total ?? p.score,
        fedexPoints: points,
        status,
      };
    });
    return rows;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Public: pull the live field. FREE by default (ESPN).
// ---------------------------------------------------------------------
export async function fetchLiveField(): Promise<GolferRow[]> {
  const espn = await fromESPN();
  if (espn && espn.length) return espn;
  const dg = await fromDataGolf();
  if (dg && dg.length) return dg;
  return [];
}