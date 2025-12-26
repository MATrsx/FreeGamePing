/**
 * Discord Bot Slash Commands Registrierung
 * Führe dieses Script einmal aus, um die Commands zu registrieren
 * 
 * Verwendung: node register-commands.js
 */

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID; 
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const commands = [
  {
    name: 'setup',
    description: 'Richte den Bot ein und wähle einen Channel für Benachrichtigungen',
    options: [
      {
        name: 'channel',
        description: 'Der Channel in dem die Spiele gepostet werden sollen',
        type: 7, // CHANNEL type
        required: false
      }
    ]
  },
  {
    name: 'disable',
    description: 'Deaktiviere den Bot auf diesem Server'
  },
  {
    name: 'status',
    description: 'Zeige den aktuellen Status des Bots'
  },
  {
    name: 'check',
    description: 'Prüfe sofort auf neue kostenlose Spiele (nur für Testing)'
  }
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    
    if (response.ok) {
      console.log('✅ Slash Commands erfolgreich registriert!');
      console.log('Die Commands sind jetzt verfügbar:');
      console.log('  /setup [channel] - Bot einrichten');
      console.log('  /disable - Bot deaktivieren');
      console.log('  /status - Status anzeigen');
      console.log('  /check - Manuell auf Spiele prüfen');
    } else {
      console.error('❌ Fehler:', await response.text());
    }
  } catch (error) {
    console.error('❌ Fehler beim Registrieren:', error);
  }
}

registerCommands();