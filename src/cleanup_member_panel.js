const { Client, GatewayIntentBits } = require('discord.js');
const { channels } = require('./config/channels');
const { createMemberPanelEmbed, createMemberPanelButtons } = require('./ui/panels');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('clientReady', async () => {
  try {
    const memChId = channels['painel-membros'];
    if (memChId) {
      const ch = await client.channels.fetch(memChId).catch(() => null);
      if (ch) {
        let fetched;
        do {
          fetched = await ch.messages.fetch({ limit: 100 });
          if (fetched.size > 0) {
            await ch.bulkDelete(fetched, true).catch(async () => {
              for (const m of fetched.values()) {
                await m.delete().catch(() => {});
              }
            });
          }
        } while (fetched.size >= 2);

        await ch.send({
          embeds: [createMemberPanelEmbed()],
          components: createMemberPanelButtons()
        });
        console.log('[OK] Canal #painel-membros limpo e painel único restaurado!');
      }
    }
    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Erro na limpeza:', err);
    client.destroy();
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
