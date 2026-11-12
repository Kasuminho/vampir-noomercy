const { MessageFlags } = require('discord.js');
const { handleSlashCommand } = require('./commandHandler');
const { handleButtonClick } = require('./buttonHandler');
const { handleModalSubmit } = require('./modalHandler');
const { handleSelectMenu } = require('./selectMenuHandler');

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      return await handleSlashCommand(interaction);
    }

    if (interaction.isButton()) {
      return await handleButtonClick(interaction);
    }

    if (interaction.isModalSubmit()) {
      return await handleModalSubmit(interaction);
    }

    if (interaction.isStringSelectMenu()) {
      return await handleSelectMenu(interaction);
    }
  } catch (error) {
    console.error('[ERRO INTERAÇÃO]', error);
    const replyOptions = {
      content: '❌ Ocorreu um erro ao processar esta ação. Tente novamente.',
      flags: MessageFlags.Ephemeral
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyOptions).catch(() => {});
    } else {
      await interaction.reply(replyOptions).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };
