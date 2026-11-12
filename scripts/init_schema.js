const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || '216.22.27.248',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'user_sSDpr4',
  password: process.env.DB_PASSWORD || 'password_ekcC7Z',
  database: process.env.DB_NAME || 'vampir_noomercy',
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10)
});

async function initSchema() {
  const client = await pool.connect();
  try {
    console.log('Criando tabelas e índices em vampir_noomercy...');
    await client.query('BEGIN');

    // 1. Members
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        user_id VARCHAR(32) PRIMARY KEY,
        user_tag VARCHAR(64),
        nick VARCHAR(64),
        classe VARCHAR(32),
        nivel INTEGER,
        cp INTEGER,
        last_approved_print TEXT,
        last_approved_at TIMESTAMPTZ,
        approved_by VARCHAR(32),
        pending_submission JSONB,
        history JSONB DEFAULT '[]'::jsonb,
        rejected_history JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_members_nick ON members(nick);
      CREATE INDEX IF NOT EXISTS idx_members_classe ON members(classe);
      CREATE INDEX IF NOT EXISTS idx_members_cp ON members(cp DESC);
      CREATE INDEX IF NOT EXISTS idx_members_nivel ON members(nivel DESC);
    `);

    // 2. DKP Balances
    await client.query(`
      CREATE TABLE IF NOT EXISTS dkp_balances (
        user_id VARCHAR(32) PRIMARY KEY,
        total_dkp INTEGER DEFAULT 0,
        locked_dkp INTEGER DEFAULT 0,
        events_attended INTEGER DEFAULT 0,
        last_event VARCHAR(128),
        last_date TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dkp_balances_total ON dkp_balances(total_dkp DESC);
    `);

    // 3. DKP History
    await client.query(`
      CREATE TABLE IF NOT EXISTS dkp_history (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        amount INTEGER NOT NULL,
        new_balance INTEGER NOT NULL,
        reason TEXT,
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dkp_history_user_id ON dkp_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_dkp_history_created_at ON dkp_history(created_at DESC);
    `);

    // 4. Attendance Events
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_events (
        id VARCHAR(64) PRIMARY KEY,
        event_key VARCHAR(64),
        event_name VARCHAR(128),
        registered_by VARCHAR(32),
        attendees JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_events_key ON attendance_events(event_key);
      CREATE INDEX IF NOT EXISTS idx_attendance_events_created_at ON attendance_events(created_at DESC);
    `);

    // 5. Presence Disputes
    await client.query(`
      CREATE TABLE IF NOT EXISTS presence_disputes (
        dispute_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        user_tag VARCHAR(64),
        event_key VARCHAR(64),
        event_name VARCHAR(128),
        base_dkp INTEGER,
        print_url TEXT,
        note TEXT,
        status VARCHAR(32) DEFAULT 'pending',
        reviewed_by VARCHAR(32),
        reviewed_at TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_disputes_user_id ON presence_disputes(user_id);
      CREATE INDEX IF NOT EXISTS idx_disputes_status ON presence_disputes(status);
      CREATE INDEX IF NOT EXISTS idx_disputes_created_at ON presence_disputes(created_at DESC);
    `);

    // 6. Ausências
    await client.query(`
      CREATE TABLE IF NOT EXISTS ausencias (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        user_tag VARCHAR(64),
        start_date VARCHAR(64),
        end_date VARCHAR(64),
        period VARCHAR(128),
        event_or_date VARCHAR(128),
        reason TEXT,
        status VARCHAR(32) DEFAULT 'approved',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ausencias_user_id ON ausencias(user_id);
      CREATE INDEX IF NOT EXISTS idx_ausencias_created_at ON ausencias(created_at DESC);
    `);

    // 7. Leilões
    await client.query(`
      CREATE TABLE IF NOT EXISTS auctions (
        id VARCHAR(64) PRIMARY KEY,
        item_name VARCHAR(128),
        description TEXT,
        seller_id VARCHAR(32),
        current_bid INTEGER DEFAULT 0,
        highest_bidder VARCHAR(32),
        status VARCHAR(32) DEFAULT 'active',
        ends_at TIMESTAMPTZ,
        bids JSONB DEFAULT '[]'::jsonb,
        raw_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
    `);

    // 8. System Config
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('Todas as tabelas e índices criados com sucesso!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar schema:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initSchema().catch(console.error);
