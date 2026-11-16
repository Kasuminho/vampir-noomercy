const { Client, GatewayIntentBits } = require('discord.js');
const { initDatabase, getLeiloes } = require('../src/database/db');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function main() {
  await initDatabase();
  const ch = await client.channels.fetch('1569077066538942468').catch(e => console.error(e));
  if (ch) {
    console.log('Channel Name:', ch.name);
    console.log('Channel Type:', ch.type);
    console.log('Parent ID / Category:', ch.parentId);
    console.log('Position:', ch.position);
    console.log('Topic:', ch.topic);
    
    // Fetch all messages
    let allMsgs = [];
    let lastId;
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      const msgs = await ch.messages.fetch(options);
      allMsgs.push(...msgs.values());
      if (msgs.size !== 100) break;
      lastId = msgs.last().id;
    }

    console.log('Total messages fetched in #leilao-drops:', allMsgs.length);
    // Sort chronological
    allMsgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    
    for (const m of allMsgs) {
      console.log('--------------------------------------------------');
      console.log(`MSG ID: ${m.id} | Author: ${m.author.tag} | Date: ${m.createdAt.toISOString()}`);
      if (m.content) console.log('Content:', m.content);
      for (const e of m.embeds) {
        console.log(`Embed Title: ${e.title}`);
        console.log(`Embed Desc: ${e.description}`);
        if (e.image) console.log(`Embed Image: ${e.image.url}`);
      }
      for (const a of m.attachments.values()) {
        console.log(`Attachment: ${a.name} (${a.url})`);
      }
    }
  }

  const leiloes = getLeiloes();
  console.log('\n================ DB LEILOES ================');
  console.log('Active auctions in DB:', Object.keys(leiloes.active || {}).length);
  console.log('History auctions in DB:', (leiloes.history || []).length);
  for (const [id, a] of Object.entries(leiloes.active || {})) {
    console.log('ACTIVE:', id, a.itemName, a.status, a.endsAt, a.highestBidderTag);
  }
  for (const h of (leiloes.history || [])) {
    console.log('HISTORY:', h.id, h.itemName, h.status, h.highestBidderTag, h.currentBid, h.finishedAt);
  }

  process.exit(0);
}

client.once('clientReady', main);
client.login(process.env.DISCORD_TOKEN);
