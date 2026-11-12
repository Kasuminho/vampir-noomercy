const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || '216.22.27.248',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'user_sSDpr4',
  password: process.env.DB_PASSWORD || 'password_ekcC7Z',
  database: process.env.DB_NAME || 'vampir_noomercy',
  max: 5
});

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(filename, def = {}) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return def;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error(`Erro ao ler ${filename}:`, e.message);
    return def;
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Iniciando migração de JSON para PostgreSQL (vampir_noomercy)...');
    await client.query('BEGIN');

    // 1. Config
    const config = readJson('config.json');
    if (Object.keys(config).length > 0) {
      await client.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        ['main_config', JSON.stringify(config)]
      );
      console.log('✅ system_config migrado com sucesso.');
    }

    // 2. Members
    const members = readJson('members.json');
    let memberCount = 0;
    for (const [userId, m] of Object.entries(members)) {
      await client.query(
        `INSERT INTO members (
           user_id, user_tag, nick, classe, nivel, cp,
           last_approved_print, last_approved_at, approved_by,
           pending_submission, history, rejected_history, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           user_tag = EXCLUDED.user_tag,
           nick = EXCLUDED.nick,
           classe = EXCLUDED.classe,
           nivel = EXCLUDED.nivel,
           cp = EXCLUDED.cp,
           last_approved_print = EXCLUDED.last_approved_print,
           last_approved_at = EXCLUDED.last_approved_at,
           approved_by = EXCLUDED.approved_by,
           pending_submission = EXCLUDED.pending_submission,
           history = EXCLUDED.history,
           rejected_history = EXCLUDED.rejected_history,
           updated_at = NOW();`,
        [
          userId,
          m.userTag || null,
          m.nick || null,
          m.classe || null,
          m.nivel || null,
          m.cp || null,
          m.lastApprovedPrint || null,
          m.lastApprovedAt ? new Date(m.lastApprovedAt) : null,
          m.approvedBy || null,
          m.pendingSubmission ? JSON.stringify(m.pendingSubmission) : null,
          JSON.stringify(m.history || []),
          JSON.stringify(m.rejectedHistory || [])
        ]
      );
      memberCount++;
    }
    console.log(`✅ ${memberCount} membros migrados para members.`);

    // 3. DKP
    const dkp = readJson('dkp.json', { balances: {}, history: [] });
    let dkpCount = 0;
    for (const [userId, b] of Object.entries(dkp.balances || {})) {
      await client.query(
        `INSERT INTO dkp_balances (
           user_id, total_dkp, locked_dkp, events_attended, last_event, last_date, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           total_dkp = EXCLUDED.total_dkp,
           locked_dkp = EXCLUDED.locked_dkp,
           events_attended = EXCLUDED.events_attended,
           last_event = EXCLUDED.last_event,
           last_date = EXCLUDED.last_date,
           updated_at = NOW();`,
        [
          userId,
          b.totalDkp || 0,
          b.lockedDkp || 0,
          b.eventsAttended || 0,
          b.lastEvent || null,
          b.lastDate ? new Date(b.lastDate) : null
        ]
      );
      dkpCount++;
    }
    console.log(`✅ ${dkpCount} saldos DKP migrados para dkp_balances.`);

    let dkpHistCount = 0;
    for (const h of dkp.history || []) {
      await client.query(
        `INSERT INTO dkp_history (id, user_id, amount, new_balance, reason, meta, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING;`,
        [
          h.id || `dkp_${Date.now()}_${Math.random()}`,
          h.userId,
          h.amount,
          h.newBalance,
          h.reason || null,
          JSON.stringify(h.meta || {}),
          h.date ? new Date(h.date) : new Date()
        ]
      );
      dkpHistCount++;
    }
    console.log(`✅ ${dkpHistCount} registros de histórico DKP migrados.`);

    // 4. Presenças & Contestações
    const presencas = readJson('presencas.json', { events: {}, disputes: {} });
    let eventCount = 0;
    for (const [evtId, evt] of Object.entries(presencas.events || {})) {
      await client.query(
        `INSERT INTO attendance_events (id, event_key, event_name, registered_by, attendees, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING;`,
        [
          evtId,
          evt.eventKey || null,
          evt.eventName || null,
          evt.registeredBy || null,
          JSON.stringify(evt.attendees || []),
          evt.createdAt ? new Date(evt.createdAt) : new Date()
        ]
      );
      eventCount++;
    }
    console.log(`✅ ${eventCount} eventos de presença migrados.`);

    let disputeCount = 0;
    for (const [dispId, disp] of Object.entries(presencas.disputes || {})) {
      await client.query(
        `INSERT INTO presence_disputes (
           dispute_id, user_id, user_tag, event_key, event_name,
           base_dkp, print_url, note, status, reviewed_by, reviewed_at,
           rejection_reason, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (dispute_id) DO NOTHING;`,
        [
          dispId,
          disp.userId,
          disp.userTag || null,
          disp.eventKey || null,
          disp.eventName || null,
          disp.baseDkp || null,
          disp.printUrl || null,
          disp.note || null,
          disp.status || 'pending',
          disp.reviewedBy || null,
          disp.reviewedAt ? new Date(disp.reviewedAt) : null,
          disp.rejectionReason || null,
          disp.createdAt ? new Date(disp.createdAt) : new Date()
        ]
      );
      disputeCount++;
    }
    console.log(`✅ ${disputeCount} contestações migradas.`);

    // 5. Ausências
    const ausencias = readJson('ausencias.json', { requests: [], list: [] });
    const allAus = [...(ausencias.requests || []), ...(ausencias.list || [])];
    let ausCount = 0;
    for (const a of allAus) {
      if (!a.id && !a.userId) continue;
      const aId = a.id || `abs_${Date.now()}_${Math.random()}`;
      await client.query(
        `INSERT INTO ausencias (
           id, user_id, user_tag, start_date, end_date, period, event_or_date, reason, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING;`,
        [
          aId,
          a.userId,
          a.userTag || null,
          a.startDate || null,
          a.endDate || null,
          a.period || null,
          a.eventOrDate || null,
          a.reason || null,
          a.status || 'approved',
          a.registeredAt ? new Date(a.registeredAt) : new Date()
        ]
      );
      ausCount++;
    }
    console.log(`✅ ${ausCount} justificativas de ausência migradas.`);

    // 6. Leilões
    const leiloes = readJson('leiloes.json', { active: {}, history: [] });
    let leilaoCount = 0;
    for (const [lId, l] of Object.entries(leiloes.active || {})) {
      await client.query(
        `INSERT INTO auctions (
           id, item_name, description, seller_id, current_bid, highest_bidder,
           status, ends_at, bids, raw_data, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (id) DO UPDATE SET
           current_bid = EXCLUDED.current_bid,
           highest_bidder = EXCLUDED.highest_bidder,
           status = EXCLUDED.status,
           ends_at = EXCLUDED.ends_at,
           bids = EXCLUDED.bids,
           raw_data = EXCLUDED.raw_data,
           updated_at = NOW();`,
        [
          lId,
          l.itemName || null,
          l.description || null,
          l.sellerId || null,
          l.currentBid || 0,
          l.highestBidder || null,
          'active',
          l.endsAt ? new Date(l.endsAt) : null,
          JSON.stringify(l.bids || []),
          JSON.stringify(l)
        ]
      );
      leilaoCount++;
    }
    for (const h of leiloes.history || []) {
      if (!h.id) continue;
      await client.query(
        `INSERT INTO auctions (
           id, item_name, description, seller_id, current_bid, highest_bidder,
           status, ends_at, bids, raw_data, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (id) DO NOTHING;`,
        [
          h.id,
          h.itemName || null,
          h.description || null,
          h.sellerId || null,
          h.currentBid || 0,
          h.highestBidder || null,
          h.status || 'finished',
          h.endsAt ? new Date(h.endsAt) : null,
          JSON.stringify(h.bids || []),
          JSON.stringify(h)
        ]
      );
      leilaoCount++;
    }
    console.log(`✅ ${leilaoCount} leilões migrados.`);

    await client.query('COMMIT');
    console.log('🎉 Migração concluída com 100% de sucesso!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro durante a migração:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
