const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const { handleInteraction } = require('./handlers/interactionHandler');
const { startDecayScheduler } = require('./services/monthlyDecayService');
const { finalizeAuction, renderAuctionEmbed, closeAuctionThread } = require('./services/auctionService');
const { getMemberDkp } = require('./services/memberService');
const { logAuctionWon } = require('./services/loggerService');
const { handleTicketMessage } = require('./services/ticketService');
const { getLeiloes, initDatabase, syncActiveAuctions } = require('./database/db');
const { channels } = require('./config/channels');
const { startWebServer } = require('./server/webServer');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Timer periódico para checar e finalizar leilões que expiraram
function startAuctionChecker() {
  setInterval(async () => {
    try {
      await syncActiveAuctions().catch(() => {});
      const leiloes = getLeiloes();
      const now = Date.now();

      for (const [itemId, auction] of Object.entries(leiloes.active || {})) {
        if (now >= auction.endsAtTimestamp) {
          const finished = finalizeAuction(itemId);
          if (finished) {
            console.log(`[LEILÃO] Item ${finished.itemName} finalizado automaticamente!`);
            await closeAuctionThread(client, finished).catch(err => console.error('Erro ao fechar thread no checker:', err));
          }
        }
      }
    } catch (err) {
      console.error('[ERRO AUCTION CHECKER]', err);
    }
  }, 10000); // Checa a cada 10 segundos
}

client.once('clientReady', async () => {
  console.log(`[NOOMERCY BOT] Online e pronto como ${client.user.tag}!`);

  // Hidrata o cache de membros do Discord em background para auditoria imediata
  for (const guild of client.guilds.cache.values()) {
    try {
      const fetched = await guild.members.fetch();
      console.log(`[GUILD MEMBERS] Cache inicial hidratado para "${guild.name}": ${fetched.size} membros.`);
    } catch (err) {
      console.warn(`[GUILD MEMBERS] Aviso ao buscar membros de "${guild.name}":`, err.message);
    }
  }

  // Inicia scheduler de virada mensal (Dia 1 às 00:00)
  startDecayScheduler(client, channels['logs-dkp']);

  // Inicia monitor de encerramento de leilões
  startAuctionChecker();

  // Inicia o Web Server para o Painel de Leilões em Lote (Porta 3000 / localhost)
  startWebServer(client);

  console.log('[SISTEMA] Módulos de presença, CP, DKP Lock, Leilões em Lote e Virada Mensal prontos.');
});

client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction);
});

// Auto-limpeza de mensagens de chat normais nos canais de painéis fixos (anti-flood)
const PROTECTED_PANEL_CHANNELS = new Set([
  channels['registro'],
  channels['painel-membros'],
  channels['atualizacao-cp'],
  channels['justificar-ausencia'],
  channels['contestacao-presenca'],
  channels['comando-staff']
]);

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 1. Processa interação de Ticket se estiver em uma Thread de Ticket
  const handledByTicket = await handleTicketMessage(message).catch(err => {
    console.error('Erro no ticket message:', err);
    return false;
  });
  if (handledByTicket) return;

  // 2. Anti-flood em canais de painéis protegidos (ignora mensagens dentro de threads!)
  if (!message.channel.isThread() && PROTECTED_PANEL_CHANNELS.has(message.channelId)) {
    // Apaga mensagens digitadas por membros para não poluir o painel
    await message.delete().catch(() => {});
  }
});

async function main() {
  await initDatabase();
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(err => {
  console.error('Falha crítica ao iniciar bot:', err);
  process.exit(1);
});
