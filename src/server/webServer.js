const http = require('http');
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { channels } = require('../config/channels');
const { getLeiloes, saveLeiloes, syncActiveAuctions, getDeliveriesData, toggleAuctionDelivery } = require('../database/db');
const { startAuction, renderAuctionEmbed, createAuctionPost } = require('../services/auctionService');
const { notifyItemDelivered } = require('../services/loggerService');

const PORT = parseInt(process.env.PORT || process.env.OVERLAY_PORT || '3001', 10);
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

    // 3. ROTA DE CONSULTA DE LEILÕES ATIVOS (SINCRONIZADA COM BANCO)
    if (url.pathname === '/api/auctions/active' && req.method === 'GET') {
      const active = await syncActiveAuctions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        guildId: process.env.GUILD_ID || '1561462359124480042',
        active: Object.values(active || {})
      }));
    }

    // 3.1 ROTA DE GESTÃO DE ENTREGAS
    if (url.pathname === '/api/deliveries' && req.method === 'GET') {
      const deliveries = await getDeliveriesData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        guildId: process.env.GUILD_ID || '1561462359124480042',
        deliveries
      }));
    }

    // 3.2 ROTA DE ALTERAR STATUS DE ENTREGA INDIVIDUAL
    if (url.pathname === '/api/deliveries/toggle' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { auctionId, delivered, deliveredBy } = payload;
          if (!auctionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'auctionId é obrigatório' }));
          }
          const result = await toggleAuctionDelivery(auctionId, Boolean(delivered), deliveredBy || 'Staff');
          if (Boolean(delivered) && client) {
            try {
              const deliveries = await getDeliveriesData();
              const item = deliveries.find(d => String(d.id) === String(auctionId));
              if (item && item.highestBidderId) {
                await notifyItemDelivered({
                  client,
                  memberId: item.highestBidderId,
                  nick: item.highestBidderNick,
                  items: [{
                    itemName: item.itemName,
                    currentBid: item.currentBid,
                    targetClass: item.targetClass
                  }],
                  deliveredBy: deliveredBy || 'Staff'
                });
              }
            } catch (notifyErr) {
              console.error('[DELIVERY NOTIFY ERROR]:', notifyErr.message);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 3.3 ROTA DE ALTERAR STATUS DE ENTREGA EM LOTE (POR JOGADOR)
    if (url.pathname === '/api/deliveries/batch' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { auctionIds, delivered, deliveredBy } = payload;
          if (!Array.isArray(auctionIds) || auctionIds.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'auctionIds deve ser um array não-vazio' }));
          }
          for (const aId of auctionIds) {
            await toggleAuctionDelivery(aId, Boolean(delivered), deliveredBy || 'Staff');
          }
          if (Boolean(delivered) && client) {
            try {
              const deliveries = await getDeliveriesData();
              const matchingItems = deliveries.filter(d => auctionIds.map(String).includes(String(d.id)));
              const byUser = {};
              for (const it of matchingItems) {
                if (!it.highestBidderId) continue;
                if (!byUser[it.highestBidderId]) {
                  byUser[it.highestBidderId] = {
                    nick: it.highestBidderNick,
                    items: []
                  };
                }
                byUser[it.highestBidderId].items.push({
                  itemName: it.itemName,
                  currentBid: it.currentBid,
                  targetClass: it.targetClass
                });
              }
              for (const [uid, uData] of Object.entries(byUser)) {
                await notifyItemDelivered({
                  client,
                  memberId: uid,
                  nick: uData.nick,
                  items: uData.items,
                  deliveredBy: deliveredBy || 'Staff'
                });
              }
            } catch (notifyErr) {
              console.error('[DELIVERY BATCH NOTIFY ERROR]:', notifyErr.message);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, count: auctionIds.length, delivered: Boolean(delivered) }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
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
          const cleanOld = Boolean(payload.cleanOld);

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

          // Se a opção de limpar tópicos antigos estiver marcada, limpa com controle de taxa
          if (cleanOld) {
            console.log('[LEILÃO BATCH] Iniciando limpeza de tópicos antigos no fórum #leilao-drops...');
            try {
              // 1. Threads ativas
              const active = await ch.threads.fetchActive().catch(() => null);
              if (active && active.threads) {
                for (const [, thread] of active.threads) {
                  await thread.delete('Limpeza de leilões antigos pelo Painel Web').catch(err => {
                    console.warn(`[CLEAN OLD] Erro ao deletar thread ativa ${thread.id}:`, err.message);
                  });
                  await new Promise(r => setTimeout(r, 350));
                }
              }
              // 2. Threads arquivadas (com paginação)
              let hasMore = true;
              let before = null;
              while (hasMore) {
                const options = { limit: 100 };
                if (before) options.before = before;
                const archived = await ch.threads.fetchArchived(options).catch(() => null);
                if (!archived || !archived.threads || archived.threads.size === 0) {
                  break;
                }
                for (const [, thread] of archived.threads) {
                  await thread.delete('Limpeza de leilões antigos pelo Painel Web').catch(err => {
                    console.warn(`[CLEAN OLD] Erro ao deletar thread arquivada ${thread.id}:`, err.message);
                  });
                  await new Promise(r => setTimeout(r, 350));
                }
                hasMore = archived.hasMore && archived.threads.size > 0;
                if (archived.threads.size > 0) {
                  before = archived.threads.last().id;
                }
              }
              console.log('[LEILÃO BATCH] Limpeza de tópicos antigos concluída com sucesso!');
            } catch (cleanErr) {
              console.error('[LEILÃO BATCH] Erro durante limpeza de tópicos:', cleanErr.message);
            }
          }

          const created = [];

          for (const item of auctionsList) {
            const itemName = (item.itemName || '').trim();
            if (!itemName) continue;

            const targetClass = item.targetClass || 'Livre';
            const minBid = parseInt(item.minBid, 10) || 30;
            const durationMinutes = parseInt(item.durationMinutes, 10) || 15;
            const endsAtTimestamp = item.endsAtTimestamp ? parseInt(item.endsAtTimestamp, 10) : null;

            // 1. Cria o leilão no banco/memória
            const auction = startAuction({
              itemName,
              targetClass,
              minBid,
              durationMinutes,
              endsAtTimestamp,
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

            // Delay anti-rate-limit entre posts de tópicos
            await new Promise(r => setTimeout(r, 700));
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
