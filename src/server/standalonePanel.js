const { Client, GatewayIntentBits } = require('discord.js');
const { initDatabase } = require('../database/db');
const { startWebServer } = require('./webServer');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function run() {
  console.log('============================================================');
  console.log('🦇 INICIANDO PAINEL WEB DE LEILÕES (STANDALONE / LOCALHOST)...');
  console.log('============================================================');

  // Conecta ao PostgreSQL remoto
  await initDatabase();

  client.once('clientReady', () => {
    const port = process.env.PORT || process.env.OVERLAY_PORT || '3001';
    console.log(`🤖 Vlad conectado ao Discord via API para envio de leilões!`);
    startWebServer(client);
    console.log('\n============================================================');
    console.log('🔥 PAINEL WEB DE LEILÕES EM LOTE ATIVO COM SUCESSO!');
    console.log(`👉 Acesse no seu navegador: http://localhost:${port}`);
    console.log('📋 Dê CTRL+V em qualquer lugar da tela para colar os prints!');
    console.log('🚀 Clique em "Lançar Todos os Leilões" para postar no Discord.');
    console.log('============================================================\n');
  });

  await client.login(process.env.DISCORD_TOKEN);
}

run().catch(err => {
  console.error('❌ Falha ao iniciar painel standalone:', err);
  process.exit(1);
});
