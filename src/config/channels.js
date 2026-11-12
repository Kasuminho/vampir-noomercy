const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CHANNELS_FILE = path.join(__dirname, '..', '..', 'discord_channels.json');

let channelsConfig = {};
if (fs.existsSync(CHANNELS_FILE)) {
  try {
    channelsConfig = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8'));
  } catch (e) {
    console.error('Erro ao ler discord_channels.json:', e);
  }
}

module.exports = {
  guildId: process.env.GUILD_ID,
  clientId: process.env.CLIENT_ID,
  roles: {
    staff: '1561469578800930926',
    admGuerra: '1563571540262391968',
    lider: '1567311660966744264'
  },
  classRoles: {
    'Akasha': '1569543441791320174',
    'Bloodstained': '1569543830188064868',
    'Grim Reaper': '1569543916188082206',
    'Carnage': '1569543684456714240',
    'Viper': '1569543570837344296',
    'Vyper': '1569543570837344296'
  },
  channels: channelsConfig.channels || {}
};
