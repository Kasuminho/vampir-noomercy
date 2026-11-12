const { REST, Routes } = require('discord.js');
const { getSlashCommands } = require('./slashCommands');
require('dotenv').config();

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = getSlashCommands().map(c => c.toJSON());

  try {
    console.log(`[SLASH] Iniciando atualização de ${commands.length} comandos na guilda ${process.env.GUILD_ID}...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log(`[SLASH SUCESSO] ${data.length} comandos registrados com sucesso no Discord!`);
    return true;
  } catch (error) {
    console.error('[SLASH ERRO] Falha ao registrar comandos slash:', error);
    return false;
  }
}

if (require.main === module) {
  registerCommands().then(() => process.exit(0));
}

module.exports = { registerCommands };
