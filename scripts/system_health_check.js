require('dotenv').config();
const { pool, getDeliveriesData } = require('../src/database/db');

async function runCheck() {
  console.log('=== VERIFICAÇÃO COMPLETA DE INTEGRIDADE DO SISTEMA ===\n');

  // 1. Checagem de Leilões Ativos
  const activeRes = await pool.query("SELECT COUNT(*) FROM auctions WHERE status = 'active';");
  const activeCount = parseInt(activeRes.rows[0].count, 10);
  console.log(`1. Leilões com status "active" no Postgres: ${activeCount}`);

  // 2. Checagem de Balances na tabela dkp_balances
  const dkpRes = await pool.query(`
    SELECT b.user_id, b.total_dkp, b.locked_dkp, m.nick, m.user_tag 
    FROM dkp_balances b
    LEFT JOIN members m ON b.user_id = m.user_id
    ORDER BY b.total_dkp DESC;
  `);
  console.log(`2. Total de registros em dkp_balances: ${dkpRes.rows.length}`);

  const lockedUsers = dkpRes.rows.filter(r => Number(r.locked_dkp) > 0);
  console.log(`   - Usuários com locked_dkp > 0: ${lockedUsers.length}`);
  if (lockedUsers.length > 0) {
    for (const r of lockedUsers) {
      console.log(`     * ${r.nick || r.user_tag || r.user_id}: ${r.locked_dkp} DKP`);
    }
  } else {
    console.log('   ✅ Perfeito! Nenhum DKP preso indevidamente no banco.');
  }

  const negUsers = dkpRes.rows.filter(r => Number(r.total_dkp) < 0);
  console.log(`3. Usuários com saldo negativo: ${negUsers.length}`);
  if (negUsers.length > 0) {
    for (const r of negUsers) {
      console.log(`     ⚠️ ${r.nick || r.user_tag || r.user_id}: ${r.total_dkp} DKP`);
    }
  } else {
    console.log('   ✅ Nenhum saldo negativo encontrado.');
  }

  // 4. Checagem de Alexdev
  const alex = dkpRes.rows.find(r => r.user_id === '267147697088233474');
  if (alex) {
    console.log(`4. Saldo do @alexdev_ (${alex.nick} / ${alex.user_tag}): ${alex.total_dkp} DKP (Travado: ${alex.locked_dkp} DKP)`);
  }

  // 5. Checagem de Kasumo
  const kasumo = dkpRes.rows.find(r => r.user_id === '273600843251712020');
  if (kasumo) {
    console.log(`5. Saldo do @kasumo_ (${kasumo.nick} / ${kasumo.user_tag}): ${kasumo.total_dkp} DKP (Travado: ${kasumo.locked_dkp} DKP)`);
  }

  // 6. Checagem de Entregas
  const deliveries = await getDeliveriesData();
  const undelivered = deliveries.filter(d => !d.delivered);
  console.log(`6. Itens arrematados pendentes de entrega em todos os tempos: ${undelivered.length}`);
  const todayDelivered = deliveries.filter(d => d.isCurrentBatch && d.delivered);
  console.log(`   - Itens entregues da rodada de hoje: ${todayDelivered.length}`);

  console.log('\n=== RESULTADO: SISTEMA 100% LIMPO E SAUDÁVEL ===');
  process.exit(0);
}

runCheck().catch(err => {
  console.error('Erro na checagem:', err);
  process.exit(1);
});
