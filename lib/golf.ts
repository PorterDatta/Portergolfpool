// lib/golf.ts
// Live golf data — 100% FREE. No API key required.
//
// ESPN public scoreboard JSON is the PRIMARY source (free, no key).
// FedEx Cup points are DERIVED from finishing position using the fixed
// playoff points table below, with correct TIE-SPLITTING.
// DataGolf is only used if a key happens to be set (optional override).

export interface GolferRow {
  externalId: string;
  fullName: string;
  country?: string;
  headshotUrl?: string;
  worldRank?: number;
  fedexRank?: number;
  position?: string;
  positionNum?: number;
  today?: number;
  totalToPar?: number;
  fedexPoints: number;
  status: 'active' | 'cut' | 'wd' | 'dq' | 'finished';
}

const PLAYOFF_POINTS: Record<number, number> = {
  1: 2000, 2: 1200, 3: 760, 4: 540, 5: 440, 6: 400, 7: 360, 8: 340, 9: 320,
  10: 300, 11: 280, 12: 260, 13: 244, 14: 228, 15: 212, 16: 196, 17: 180,
  18: 164, 19: 148, 20: 140, 21: 132, 22: 124, 23: 116, 24: 108, 25: 100,
  26: 96, 27: 92, 28: 88, 29: 84, 30: 80, 31: 76, 32: 72, 33: 68, 34: 64,
  35: 60.8, 36: 57.6, 37: 54.4, 38: 51.2, 39: 48, 40: 44.8, 41: 41.6,
  42: 38.4, 43: 35.2, 44: 32, 45: 29.6, 46: 27.2, 47: 24.8, 48: 22.72,
  49: 20.8, 50: 19.36, 51: 18.24, 52: 17.44, 53: 16.8, 54: 16.32, 55: 16,
  56: 15.68, 57: 15.36, 58: 15.04, 59: 14.72, 60: 14.4, 61: 14.08,
  62: 13.76, 63: 13.44, 64: 13.12, 65: 12.8, 66: 12.48, 67: 12.16,
  68: 11.84, 69: 11.52, 70: 11.2,
};

function slotPoints(slot: number): number {
  return PLAYOFF_POINTS[slot] ?? 0;
}

export function pointsForPosition(pos: number, tieCount = 1): number {
  if (!pos || pos < 1) return 0;
  let sum = 0;
  for (let s = pos; s < pos + tieCount; s++) sum += slotPoints(s);
  return Math.round((sum / tieCount) * 100) / 100;
}

function parsePosition(p?: string): number | undefined {
  if (!p) return undefined;
  const n = parseInt(p.replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? undefined : n;
}

function applyTieAwarePoints(field: GolferRow[]): GolferRow[] {
  const byPos = new Map<number, GolferRow[]>();
  for (const g of field) {
    if (g.status === 'cut' || g.status === 'wd' || g.status === 'dq') {
      g.fedexPoints = 0;
      continue;
    }
    if (g.positionNum == null) { g.fedexPoints = 0; continue; }
    const arr = byPos.get(g.positionNum) ?? [];
    arr.push(g);
    byPos.set(g.positionNum, arr);
  }
  for (const [pos, players] of byPos) {
    const pts = pointsForPosition(pos, players.length);
    for (const p of players) p.fedexPoints = pts;
  }
  return field;
}

async function fromESPN(): Promise<GolferRow[] | null> {
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const comp = data?.events?.[0]?.competitions?.[0];
    const players = comp?.competitors ?? [];
    if (!players.length) return null;

    const rows: GolferRow[] = players.map((c: any): GolferRow => {
      const a = c.athlete ?? {};
      const posStr =
        c.status?.position?.displayName ??
        c.status?.position?.id ??
        String(c.order ?? '');
      const posNum = parsePosition(posStr);
      const desc = (c.status?.type?.description ?? '').toLowerCase();
      const cut = /cut/.test(desc);
      const wd = /withdraw/.test(desc);
      const dq = /disqualif/.test(desc);
      return {
        externalId: String(a.id),
        fullName: a.displayName,
        country: a.flag?.alt,
        headshotUrl: a.headshot?.href,
        position: posStr,
        positionNum: posNum,
        today: Number(c.linescores?.at(-1)?.value) || undefined,
        totalToPar: Number(c.score),
        fedexPoints: 0,
        status: cut ? 'cut' : wd ? 'wd' : dq ? 'dq'
              : c.status?.type?.completed ? 'finished' : 'active',
      };
    });

    return applyTieAwarePoints(rows);
  } catch {
    return null;
  }
}

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
        /cut/i.test(p.current_pos ?? '') ? 'cut'
        : /wd/i.test(p.current_pos ?? '') ? 'wd'
        : /dq/i.test(p.current_pos ?? '') ? 'dq'
        : (p.thru === 'F' || p.round === 4) ? 'finished'
        : 'active';
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
        fedexPoints: Number(p.fedex_cup_points ?? p.projected_fedex_points ?? 0) || 0,
        status,
      } as GolferRow;
    });

    const hasPoints = rows.some((r) => r.fedexPoints > 0);
    return hasPoints ? rows : applyTieAwarePoints(rows);
  } catch {
    return null;
  }
}

export async function fetchLiveField(): Promise<GolferRow[]> {
  const espn = await fromESPN();
  if (espn && espn.length) return espn;
  const dg = await fromDataGolf();
  if (dg && dg.length) return dg;
  return [];
}
