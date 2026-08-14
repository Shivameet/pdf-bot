const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('CRITICAL: BOT_TOKEN is missing in environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

bot.on('polling_error', (error) => {
  console.error('Telegram polling error:', error.message);
});

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Dokumen search bot is running.\n');
});

server.listen(PORT, () => {
  console.log(`Health-check server is listening on port ${PORT}`);
});

bot.setMyCommands([
  { command: 'start', description: 'Start the Dokumen.pub search bot' },
  { command: 'help', description: 'Learn how the search works' }
]).catch((error) => {
  console.error('Failed to register commands:', error.message);
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createGoogleSiteSearchUrl(query) {
  const googleQuery = `site:dokumen.pub ${query.trim()}`;
  return `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text?.trim();

  if (msg.chat.type !== 'private' || !messageText) {
    return;
  }

  if (messageText === '/start') {
    const welcomeMessage = [
      '<b>Dokumen.pub Search Bot</b>',
      '',
      'Send any book name, person name, or topic.',
      'The button below the result will open Google search results limited to Dokumen.pub only.',
      '',
      'The bot does not download or send files.'
    ].join('\n');

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText === '/help') {
    const helpMessage = [
      '<b>How to use this bot</b>',
      '',
      '1. Send a topic, for example: Dark psychology',
      '2. Press “Search on Dokumen.pub”',
      '3. Google will open results only from Dokumen.pub'
    ].join('\n');

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText.startsWith('/')) {
    return;
  }

  try {
    const searchUrl = createGoogleSiteSearchUrl(messageText);
    const replyText = [
      `<b>Search Results for: ${escapeHtml(messageText)}</b>`,
      '',
      'Press the button below to search only on Dokumen.pub through Google.'
    ].join('\n');

    await bot.sendMessage(chatId, replyText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🔍 Search on Dokumen.pub',
            url: searchUrl
          }
        ]]
      }
    });
  } catch (error) {
    console.error('Message dispatcher error:', error.message);

    await bot.sendMessage(
      chatId,
      '<b>System error.</b>\n\nPlease try again in a moment.',
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

console.log('Telegram Dokumen.pub Google Search Bot started successfully.');
