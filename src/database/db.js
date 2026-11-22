const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// ==========================================
// 1. CONFIGURAÇÃO DO POOL POSTGRESQL (BOAS PRÁTICAS)
// ==========================================
const pool = new Pool({
  host: process.env.DB_HOST || '216.22.27.248',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'user_sSDpr4',
  password: process.env.DB_PASSWORD || 'password_ekcC7Z',
  database: process.env.DB_NAME || 'vampir_noomercy',
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10), // Limite de conexões para não sobrecarregar
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10), // Fecha conexões ociosas após 30s
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10), // Timeout rápido de conexão
  keepAlive: true
});

pool.on('error', (err) => {
  console.error('❌ [POSTGRES POOL ERROR] Erro inesperado no cliente de conexão:', err.message);
});

// ==========================================
// 2. CACHE LOCAL SINCRONIZADO (LATÊNCIA ZERO NO DISCORD)
// ==========================================
const memoryCache = {
  config: null,
  members: null,
  dkp: { balances: {}, history: [] },
  presencas: { events: {}, disputes: {} },
  ausencias: { requests: [], list: [] },
  leiloes: { active: {}, history: [] }
};

let isInitialized = false;

// Helpers de backup em JSON local
function readJson(filename, defaultValue = {}) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`Erro ao ler ${filename}:`, err.message);
    return defaultValue;
  }
}

function saveJsonBackup(filename, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const filePath = path.join(DATA_DIR, filename);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error(`Erro ao salvar backup ${filename}:`, err.message);
  }
}

// ==========================================
// 3. INICIALIZAÇÃO E HIDRATAÇÃO DO BANCO
// ==========================================
async function initDatabase() {
  if (isInitialized) return;

  console.log('[POSTGRES] Conectando e hidratando cache a partir do banco vampir_noomercy...');
  try {
    // 1. Config
    const configRes = await pool.query("SELECT value FROM system_config WHERE key = 'main_config' LIMIT 1;");
    if (configRes.rows.length > 0) {
      memoryCache.config = configRes.rows[0].value;
    } else {
      memoryCache.config = readJson('config.json');
      await pool.query(
        "INSERT INTO system_config (key, value, updated_at) VALUES ('main_config', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;",
        [JSON.stringify(memoryCache.config)]
      ).catch(() => {});
    }

    // 2. Members
    const membersRes = await pool.query('SELECT * FROM members;');
    const membersMap = {};
    for (const r of membersRes.rows) {
      membersMap[r.user_id] = {
        userId: r.user_id,
        userTag: r.user_tag,
        nick: r.nick,
        classe: r.classe,
        nivel: r.nivel,
        cp: r.cp,
        lastApprovedPrint: r.last_approved_print,
        lastApprovedAt: r.last_approved_at ? r.last_approved_at.toISOString() : null,
        approvedBy: r.approved_by,
        pendingSubmission: r.pending_submission,
        history: r.history || [],
        rejectedHistory: r.rejected_history || []
      };
    }
    if (Object.keys(membersMap).length > 0) {
      memoryCache.members = membersMap;
    } else {
      memoryCache.members = readJson('members.json');
    }

    // 3. DKP Balances & History
    const balancesRes = await pool.query('SELECT * FROM dkp_balances;');
    const balancesMap = {};
    for (const r of balancesRes.rows) {
      balancesMap[r.user_id] = {
        userId: r.user_id,
        totalDkp: r.total_dkp,
        lockedDkp: r.locked_dkp,
        eventsAttended: r.events_attended,
        lastEvent: r.last_event,
        lastDate: r.last_date ? r.last_date.toISOString() : null
      };
    }

    const historyRes = await pool.query('SELECT * FROM dkp_history ORDER BY created_at DESC LIMIT 500;');
    const dkpHistory = historyRes.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      amount: r.amount,
      newBalance: r.new_balance,
      reason: r.reason,
      meta: r.meta,
      date: r.created_at ? r.created_at.toISOString() : null
    }));

    memoryCache.dkp = {
      balances: balancesMap,
      history: dkpHistory
    };

    // 4. Presenças & Contestações
    const eventsRes = await pool.query('SELECT * FROM attendance_events ORDER BY created_at DESC LIMIT 200;');
    const eventsMap = {};
    for (const r of eventsRes.rows) {
      eventsMap[r.id] = {
        eventKey: r.event_key,
        eventName: r.event_name,
        registeredBy: r.registered_by,
        attendees: r.attendees,
        createdAt: r.created_at ? r.created_at.toISOString() : null
      };
    }

    const disputesRes = await pool.query('SELECT * FROM presence_disputes ORDER BY created_at DESC LIMIT 300;');
    const disputesMap = {};
    for (const r of disputesRes.rows) {
      disputesMap[r.dispute_id] = {
        disputeId: r.dispute_id,
        userId: r.user_id,
        userTag: r.user_tag,
        eventKey: r.event_key,
        eventName: r.event_name,
        baseDkp: r.base_dkp,
        printUrl: r.print_url,
        note: r.note,
        status: r.status,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
        rejectionReason: r.rejection_reason,
        createdAt: r.created_at ? r.created_at.toISOString() : null
      };
    }

    memoryCache.presencas = {
      events: eventsMap,
      disputes: disputesMap
    };

    // 5. Ausências
    const ausenciasRes = await pool.query('SELECT * FROM ausencias ORDER BY created_at DESC LIMIT 500;');
    const ausList = ausenciasRes.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userTag: r.user_tag,
      startDate: r.start_date,
      endDate: r.end_date,
      period: r.period,
      eventOrDate: r.event_or_date,
      reason: r.reason,
      status: r.status,
      registeredAt: r.created_at ? r.created_at.toISOString() : null
    }));

    memoryCache.ausencias = {
      requests: ausList,
      list: ausList
    };

    // 6. Leilões
    const auctionsRes = await pool.query('SELECT * FROM auctions;');
    const activeAuctions = {};
    const auctionHistory = [];
    for (const r of auctionsRes.rows) {
      const auctionObj = {
        id: r.id,
        itemName: r.item_name,
        description: r.description,
        sellerId: r.seller_id,
        currentBid: r.current_bid,
        highestBidderId: r.highest_bidder,
        status: r.status,
        endsAt: r.ends_at ? r.ends_at.toISOString() : null,
        endsAtTimestamp: r.ends_at ? new Date(r.ends_at).getTime() : null,
        bids: r.bids || [],
        ...(r.raw_data || {})
      };
      if (r.status === 'active') {
        activeAuctions[r.id] = auctionObj;
      } else {
        auctionHistory.unshift(auctionObj);
      }
    }

    memoryCache.leiloes = {
      active: activeAuctions,
      history: auctionHistory
    };

    isInitialized = true;
    console.log(`✅ [POSTGRES] Hidratação concluída: ${Object.keys(memoryCache.members).length} membros carregados com persistência ativa!`);
  } catch (err) {
    console.error('⚠️ [POSTGRES] Falha na conexão/hidratação inicial. Usando fallback JSON local:', err.message);
    memoryCache.config = readJson('config.json');
    memoryCache.members = readJson('members.json');
    memoryCache.dkp = readJson('dkp.json', { balances: {}, history: [] });
    memoryCache.presencas = readJson('presencas.json', { events: {}, disputes: {} });
    memoryCache.ausencias = readJson('ausencias.json', { requests: [], list: [] });
    memoryCache.leiloes = readJson('leiloes.json', { active: {}, history: [] });
    isInitialized = true;
  }
}

// ==========================================
// 4. API DE PERSISTÊNCIA ATÔMICA POSTGRESQL
// ==========================================

// --- CONFIG ---
function getConfig() {
  if (!memoryCache.config) memoryCache.config = readJson('config.json');
  return memoryCache.config;
}

function saveConfig(data) {
  memoryCache.config = data;
  saveJsonBackup('config.json', data);

  pool.query(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ('main_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
    [JSON.stringify(data)]
  ).catch(err => console.error('Erro ao salvar config no Postgres:', err.message));
}

// --- MEMBERS ---
function getMembers() {
  if (!memoryCache.members) memoryCache.members = readJson('members.json');
  return memoryCache.members;
}

function saveMembers(data) {
  memoryCache.members = data;
  saveJsonBackup('members.json', data);

  // Sincroniza membros assincronamente no Postgres
  setImmediate(async () => {
    for (const [userId, m] of Object.entries(data)) {
      try {
        await pool.query(
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
      } catch (err) {
        console.error(`Erro ao salvar membro ${userId} no Postgres:`, err.message);
      }
    }
  });
}

// --- DKP ---
function getDkp() {
  if (!memoryCache.dkp || !memoryCache.dkp.balances) {
    memoryCache.dkp = readJson('dkp.json', { balances: {}, history: [] });
  }
  return memoryCache.dkp;
}

function saveDkp(data) {
  memoryCache.dkp = data;
  saveJsonBackup('dkp.json', data);

  setImmediate(async () => {
    // 1. Balances
    for (const [userId, b] of Object.entries(data.balances || {})) {
      try {
        await pool.query(
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
      } catch (err) {
        console.error(`Erro ao salvar saldo DKP de ${userId} no Postgres:`, err.message);
      }
    }

    // 2. Histórico mais recente
    if (data.history && data.history.length > 0) {
      const latest = data.history[0];
      if (latest && latest.id) {
        try {
          await pool.query(
            `INSERT INTO dkp_history (id, user_id, amount, new_balance, reason, meta, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING;`,
            [
              latest.id,
              latest.userId,
              latest.amount,
              latest.newBalance,
              latest.reason || null,
              JSON.stringify(latest.meta || {}),
              latest.date ? new Date(latest.date) : new Date()
            ]
          );
        } catch (err) {
          console.error(`Erro ao salvar histórico DKP no Postgres:`, err.message);
        }
      }
    }
  });
}

// --- PRESENÇAS E CONTESTAÇÕES ---
function getPresencas() {
  if (!memoryCache.presencas || !memoryCache.presencas.events) {
    memoryCache.presencas = readJson('presencas.json', { events: {}, disputes: {} });
  }
  return memoryCache.presencas;
}

function savePresencas(data) {
  memoryCache.presencas = data;
  saveJsonBackup('presencas.json', data);

  setImmediate(async () => {
    // 1. Events
    for (const [evtId, evt] of Object.entries(data.events || {})) {
      try {
        await pool.query(
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
      } catch (err) {
        console.error(`Erro ao salvar evento de presença ${evtId}:`, err.message);
      }
    }

    // 2. Disputes
    for (const [dispId, disp] of Object.entries(data.disputes || {})) {
      try {
        await pool.query(
          `INSERT INTO presence_disputes (
             dispute_id, user_id, user_tag, event_key, event_name,
             base_dkp, print_url, note, status, reviewed_by, reviewed_at,
             rejection_reason, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (dispute_id) DO UPDATE SET
             status = EXCLUDED.status,
             reviewed_by = EXCLUDED.reviewed_by,
             reviewed_at = EXCLUDED.reviewed_at,
             rejection_reason = EXCLUDED.rejection_reason,
             print_url = EXCLUDED.print_url;`,
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
      } catch (err) {
        console.error(`Erro ao salvar contestação ${dispId}:`, err.message);
      }
    }
  });
}

// --- AUSÊNCIAS ---
function getAusencias() {
  if (!memoryCache.ausencias || (!memoryCache.ausencias.requests && !memoryCache.ausencias.list)) {
    memoryCache.ausencias = readJson('ausencias.json', { requests: [], list: [] });
  }
  return memoryCache.ausencias;
}

function saveAusencias(data) {
  memoryCache.ausencias = data;
  saveJsonBackup('ausencias.json', data);

  setImmediate(async () => {
    const allAus = [...(data.requests || []), ...(data.list || [])];
    for (const a of allAus) {
      if (!a.id && !a.userId) continue;
      const aId = a.id || `abs_${Date.now()}_${Math.random()}`;
      try {
        await pool.query(
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
      } catch (err) {
        console.error(`Erro ao salvar ausência no Postgres:`, err.message);
      }
    }
  });
}

// --- LEILÕES ---
function getLeiloes() {
  if (!memoryCache.leiloes || !memoryCache.leiloes.active) {
    memoryCache.leiloes = readJson('leiloes.json', { active: {}, history: [] });
  }
  return memoryCache.leiloes;
}

async function syncActiveAuctions() {
  try {
    const auctionsRes = await pool.query(`
      SELECT a.*, m.nick as member_nick, m.classe as member_classe, m.user_tag as member_tag
      FROM auctions a
      LEFT JOIN members m ON a.highest_bidder = m.user_id
      WHERE a.status = 'active';
    `);
    const activeAuctions = {};
    for (const r of auctionsRes.rows) {
      const raw = r.raw_data || {};
      activeAuctions[r.id] = {
        ...raw,
        id: r.id,
        itemName: r.item_name || raw.itemName,
        description: r.description || raw.description,
        sellerId: r.seller_id || raw.sellerId,
        currentBid: (r.current_bid !== null && r.current_bid !== undefined) ? r.current_bid : (raw.currentBid || 0),
        highestBidderId: r.highest_bidder || raw.highestBidderId || null,
        highestBidderTag: r.member_tag || raw.highestBidderTag || null,
        highestBidderNick: r.member_nick || raw.highestBidderNick || null,
        highestBidderClass: r.member_classe || raw.highestBidderClass || null,
        status: r.status,
        delivered: r.delivered || raw.delivered || false,
        deliveredAt: r.delivered_at || raw.deliveredAt || null,
        deliveredBy: r.delivered_by || raw.deliveredBy || null,
        endsAt: r.ends_at ? r.ends_at.toISOString() : raw.endsAt,
        endsAtTimestamp: r.ends_at ? new Date(r.ends_at).getTime() : raw.endsAtTimestamp,
        bids: r.bids || raw.bids || []
      };
    }
    if (!memoryCache.leiloes) {
      memoryCache.leiloes = { active: activeAuctions, history: [] };
    } else {
      memoryCache.leiloes.active = activeAuctions;
    }
    return activeAuctions;
  } catch (err) {
    console.error('Erro em syncActiveAuctions:', err.message);
    return memoryCache.leiloes ? memoryCache.leiloes.active : {};
  }
}

async function getDeliveriesData() {
  try {
    const res = await pool.query(`
      SELECT a.*, m.nick as member_nick, m.classe as member_classe, m.user_tag as member_tag
      FROM auctions a
      LEFT JOIN members m ON a.highest_bidder = m.user_id
      WHERE a.current_bid > 0 AND a.highest_bidder IS NOT NULL
      ORDER BY a.ends_at DESC;
    `);

    return res.rows.map(r => {
      const raw = r.raw_data || {};
      return {
        id: r.id,
        itemName: r.item_name || raw.itemName,
        currentBid: r.current_bid,
        highestBidderId: r.highest_bidder,
        highestBidderTag: r.member_tag || raw.highestBidderTag || 'Membro',
        highestBidderNick: r.member_nick || raw.highestBidderNick || r.member_tag || 'Sem Nick',
        highestBidderClass: r.member_classe || raw.highestBidderClass || raw.targetClass || 'Livre',
        targetClass: raw.targetClass || 'Livre',
        imageUrl: raw.imageUrl || null,
        channelId: raw.channelId || null,
        status: r.status,
        delivered: r.delivered || raw.delivered || false,
        deliveredAt: r.delivered_at || raw.deliveredAt || null,
        deliveredBy: r.delivered_by || raw.deliveredBy || null,
        endsAtTimestamp: r.ends_at ? new Date(r.ends_at).getTime() : raw.endsAtTimestamp
      };
    });
  } catch (err) {
    console.error('Erro em getDeliveriesData:', err.message);
    return [];
  }
}

async function toggleAuctionDelivery(auctionId, delivered, deliveredBy = 'Staff') {
  try {
    const now = delivered ? new Date() : null;
    await pool.query(
      `UPDATE auctions
       SET delivered = $1, delivered_at = $2, delivered_by = $3,
           raw_data = jsonb_set(raw_data, '{delivered}', $4::jsonb)
       WHERE id = $5;`,
      [delivered, now, delivered ? deliveredBy : null, JSON.stringify(delivered), auctionId]
    );
    if (memoryCache.leiloes?.active?.[auctionId]) {
      memoryCache.leiloes.active[auctionId].delivered = delivered;
      memoryCache.leiloes.active[auctionId].deliveredAt = now;
      memoryCache.leiloes.active[auctionId].deliveredBy = delivered ? deliveredBy : null;
    }
    return { success: true, delivered, auctionId };
  } catch (err) {
    console.error('Erro ao alterar status de entrega:', err.message);
    return { success: false, error: err.message };
  }
}

function saveLeiloes(data) {
  memoryCache.leiloes = data;
  saveJsonBackup('leiloes.json', data);

  setImmediate(async () => {
    // 1. Ativos
    for (const [lId, l] of Object.entries(data.active || {})) {
      try {
        await pool.query(
          `INSERT INTO auctions (
             id, item_name, description, seller_id, current_bid, highest_bidder,
             status, ends_at, bids, raw_data, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
           ON CONFLICT (id) DO UPDATE SET
             current_bid = CASE WHEN EXCLUDED.current_bid > 0 THEN EXCLUDED.current_bid ELSE auctions.current_bid END,
             highest_bidder = COALESCE(EXCLUDED.highest_bidder, auctions.highest_bidder),
             status = EXCLUDED.status,
             ends_at = COALESCE(EXCLUDED.ends_at, auctions.ends_at),
             bids = CASE WHEN jsonb_array_length(EXCLUDED.bids::jsonb) > 0 THEN EXCLUDED.bids ELSE auctions.bids END,
             raw_data = auctions.raw_data || EXCLUDED.raw_data || jsonb_build_object(
               'channelId', COALESCE(EXCLUDED.raw_data->>'channelId', auctions.raw_data->>'channelId'),
               'messageId', COALESCE(EXCLUDED.raw_data->>'messageId', auctions.raw_data->>'messageId')
             ),
             updated_at = NOW();`,
          [
            lId,
            l.itemName || null,
            l.description || null,
            l.sellerId || null,
            l.currentBid || 0,
            l.highestBidderId || null,
            'active',
            l.endsAt ? new Date(l.endsAt) : null,
            JSON.stringify(l.bids || []),
            JSON.stringify(l),
            l.createdAt ? new Date(l.createdAt) : new Date()
          ]
        );
      } catch (err) {
        console.error(`Erro ao salvar leilão ativo ${lId}:`, err.message);
      }
    }

    // 2. Histórico
    for (const h of data.history || []) {
      if (!h.id) continue;
      try {
        await pool.query(
          `INSERT INTO auctions (
             id, item_name, description, seller_id, current_bid, highest_bidder,
             status, ends_at, bids, raw_data, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
           ON CONFLICT (id) DO UPDATE SET
             status = 'finished',
             highest_bidder = EXCLUDED.highest_bidder,
             current_bid = EXCLUDED.current_bid,
             updated_at = NOW();`,
          [
            h.id,
            h.itemName || null,
            h.description || null,
            h.sellerId || null,
            h.currentBid || 0,
            h.highestBidderId || null,
            'finished',
            h.endsAt ? new Date(h.endsAt) : null,
            JSON.stringify(h.bids || []),
            JSON.stringify(h),
            h.createdAt ? new Date(h.createdAt) : new Date()
          ]
        );
      } catch (err) {
        console.error(`Erro ao salvar histórico de leilão ${h.id}:`, err.message);
      }
    }
  });
}

// ==========================================
// 5. EXPORTAÇÕES
// ==========================================
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDatabase,

  getConfig,
  saveConfig,

  getMembers,
  saveMembers,

  getDkp,
  saveDkp,

  getPresencas,
  savePresencas,

  getAusencias,
  saveAusencias,

  getLeiloes,
  saveLeiloes,
  syncActiveAuctions,
  getDeliveriesData,
  toggleAuctionDelivery
};
