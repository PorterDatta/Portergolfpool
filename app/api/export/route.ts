// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabaseClient';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export const dynamic = 'force-dynamic';

async function requireCommish() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  return data?.role === 'commissioner';
}

export async function GET(req: NextRequest) {
  if (!(await requireCommish())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const type = req.nextUrl.searchParams.get('type');
  const seasonId = req.nextUrl.searchParams.get('season');
  if (!seasonId) return NextResponse.json({ error: 'season required' }, { status: 400 });

  switch (type) {
    case 'standings-xlsx':   return standingsExcel(seasonId);
    case 'picks-pdf':        return picksPdf(seasonId);
    case 'participants-csv': return participantsCsv(seasonId);
    default: return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  }
}

async function standingsExcel(seasonId: string) {
  const { data: standings } = await supabaseAdmin
    .from('standings')
    .select('rank,week1,week2,week3,total,participants(name)')
    .eq('season_id', seasonId).order('rank');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Standings');
  ws.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Player', key: 'name', width: 24 },
    { header: 'Week 1', key: 'w1', width: 12 },
    { header: 'Week 2', key: 'w2', width: 12 },
    { header: 'Week 3', key: 'w3', width: 12 },
    { header: 'Total', key: 'total', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  (standings ?? []).forEach((s: any) => {
    ws.addRow({ rank: s.rank, name: s.participants?.name, w1: s.week1, w2: s.week2, w3: s.week3, total: s.total });
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="standings.xlsx"',
    },
  });
}

async function picksPdf(seasonId: string) {
  const { data: parts } = await supabaseAdmin
    .from('participants').select('id,name').eq('season_id', seasonId).order('name');
  const { data: weeks } = await supabaseAdmin
    .from('weeks').select('id,week_number,name').eq('season_id', seasonId).order('week_number');
  const { data: picks } = await supabaseAdmin
    .from('picks').select('participant_id,week_id,golfers(full_name)');

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));

  doc.fontSize(20).text('FedEx Cup Pool — Weekly Picks', { align: 'center' });
  doc.moveDown();

  (parts ?? []).forEach((p: any) => {
    doc.fontSize(14).fillColor('#16a34a').text(p.name);
    doc.fillColor('black').fontSize(11);
    (weeks ?? []).forEach((w: any) => {
      const chosen = (picks ?? [])
        .filter((pk: any) => pk.participant_id === p.id && pk.week_id === w.id)
        .map((pk: any) => pk.golfers?.full_name);
      doc.text(`  ${w.name}: ${chosen.length ? chosen.join(', ') : '(empty)'}`);
    });
    doc.moveDown(0.6);
  });

  doc.end();
  await new Promise((r) => doc.on('end', r));
  const buf = Buffer.concat(chunks);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="picks.pdf"',
    },
  });
}

async function participantsCsv(seasonId: string) {
  const { data } = await supabaseAdmin
    .from('participants').select('name,profiles(email)').eq('season_id', seasonId).order('name');
  const rows = ['name,email', ...(data ?? []).map((p: any) => `${p.name},${p.profiles?.email ?? ''}`)];
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="participants.csv"',
    },
  });
}
