const http = require('http');
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { channels } = require('../config/channels');
const { getLeiloes, saveLeiloes } = require('../database/db');
const { startAuction, renderAuctionEmbed, createAuctionPost } = require('../services/auctionService');

const PORT = parseInt(process.env.PORT || process.env.OVERLAY_PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

function startWebServer(client) {
  const server = http.createServer(async (req, res) => {
    // Enable CORS for localhost and dev flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // 1. ROTA PRINCIPAL: SERVIR O PAINEL HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const htmlPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(htmlPath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Painel Web não encontrado.');
      }
    }

    // 2. ROTA DE STATUS DA API
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        online: client.isReady(),
        guildName: guild ? guild.name : 'Vampir NooMercy',
        channel: '#leilao-drops',
        activeAuctionsCount: Object.keys((getLeiloes() || {}).active || {}).length
      }));
    }

    // 3. ROTA DE CONSULTA DE LEILÕES ATIVOS
    if (url.pathname === '/api/auctions/active' && req.method === 'GET') {
      const leiloes = getLeiloes();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        active: Object.values(leiloes.active || {})
      }));
    }

    // 4. ROTA POST DE CRIAÇÃO DE LEILÕES EM LOTE
    if (url.pathname === '/api/auctions/batch' && req.method === 'POST') {
      let body = '';
      const MAX_SIZE = 60 * 1024 * 1024; // 60MB max para múltiplos prints base64

      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Tamanho total do lote excedeu o limite (60MB).' }));
          req.destroy();
        }
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const auctionsList = payload.auctions || [];
          const startedBy = payload.startedBy || 'Staff Web (Painel)';

          if (!Array.isArray(auctionsList) || auctionsList.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Nenhum leilão fornecido na lista.' }));
          }

          const auctionChannelId = channels['leilao-drops'];
          if (!auctionChannelId) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Canal #leilao-drops não configurado.' }));
          }

          const ch = await client.channels.fetch(auctionChannelId).catch(() => null);
          if (!ch) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Não foi possível encontrar o canal #leilao-drops no Discord.' }));
          }

          const created = [];

          for (const item of auctionsList) {
            const itemName = (item.itemName || '').trim();
            if (!itemName) continue;

            const targetClass = item.targetClass || 'Livre';
            const minBid = parseInt(item.minBid, 10) || 30;
            const durationMinutes = parseInt(item.durationMinutes, 10) || 15;

            // 1. Cria o leilão no banco/memória
            const auction = startAuction({
              itemName,
              targetClass,
              minBid,
              durationMinutes,
              startedBy
            });

            // 2. Prepara arquivos de imagem se fornecidos via base64 (CTRL+V ou upload)
            const files = [];
            if (item.imageBase64 && typeof item.imageBase64 === 'string' && item.imageBase64.includes('base64,')) {
              try {
                const base64Data = item.imageBase64.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const fileName = `drop_${auction.id}.png`;
                const attachment = new AttachmentBuilder(buffer, { name: fileName });
                files.push(attachment);
                auction.imageUrl = `attachment://${fileName}`;
              } catch (err) {
                console.error(`[LEILÃO BATCH] Erro ao decodificar imagem para ${itemName}:`, err.message);
              }
            } else if (item.imageUrl) {
              auction.imageUrl = item.imageUrl;
            }

            // 3. Cria o Tópico no Fórum #leilao-drops com as tags adequadas
            const thread = await createAuctionPost({
              client,
              auction,
              files
            }).catch(err => {
              console.error(`[LEILÃO BATCH] Erro ao criar tópico para ${itemName}:`, err.message);
              return null;
            });

            if (thread) {
              created.push({
                id: auction.id,
                itemName: auction.itemName,
                targetClass: auction.targetClass,
                minBid: auction.minBid,
                durationMinutes: auction.durationMinutes,
                messageId: thread.id,
                url: thread.url
              });
            }
          }

          // 5. Registra log de lote em #logs-dkp se houver canal configurado
          const logsChId = channels['logs-dkp'];
          if (logsChId && created.length > 0) {
            const logCh = await client.channels.fetch(logsChId).catch(() => null);
            if (logCh) {
              const itemsSummary = created.map(c => `• **${c.itemName}** [${c.targetClass}] — Mín: \`${c.minBid} DKP\` (<t:${Math.floor((Date.now() + c.durationMinutes * 60000) / 1000)}:R>)`).join('\n');
              const logEmbed = new EmbedBuilder()
                .setTitle(`📦 LOTE DE LEILÕES INICIADO (${created.length} ITENS)`)
                .setColor('#E67E22')
                .setDescription(
                  `Um lote de **${created.length} itens** foi lançado em <#${auctionChannelId}> via Painel Web:\n\n${itemsSummary}`
                )
                .setFooter({ text: `Lançado por: ${startedBy}` })
                .setTimestamp();
              await logCh.send({ embeds: [logEmbed] }).catch(() => {});
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, count: created.length, created }));
        } catch (err) {
          console.error('[ERRO BATCH AUCTION]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 404 para outras rotas
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rota não encontrada' }));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 [WEB SERVER] Painel de Leilões em Lote ativo em: http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ [WEB SERVER] Porta ${PORT} em uso. Tentando alternativa...`);
    } else {
      console.error('❌ [WEB SERVER ERROR]', err.message);
    }
  });

  return server;
}

module.exports = { startWebServer };
