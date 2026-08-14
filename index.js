const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const NodeCache = require('node-cache');

// Store successful Wikipedia results for 24 hours in memory.
const wikipediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

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

// Simple health-check endpoint for hosts such as Render.
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot service is running.\n');
});

server.listen(PORT, () => {
  console.log(`Health-check server is listening on port ${PORT}`);
});

bot.setMyCommands([
  { command: 'start', description: 'Start the bot and view instructions' },
  { command: 'language', description: 'View the active search language' }
]).catch((error) => {
  console.error('Failed to register commands:', error.message);
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getWikipediaPDFContent(query) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return null;
  }

  if (wikipediaCache.has(trimmedQuery)) {
    console.log(`Cache hit for query: "${trimmedQuery}"`);
    return wikipediaCache.get(trimmedQuery);
  }

  try {
    console.log(`Cache miss. Fetching Wikipedia data for: "${trimmedQuery}"`);

    const requestConfig = {
      headers: {
        // Replace the contact address with your own contact address before deployment.
        'User-Agent': 'TelegramResearchBot/2.0 (contact: your-email@example.com)'
      },
      timeout: 8000
    };

    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', trimmedQuery);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('format', 'json');

    const searchResponse = await axios.get(searchUrl.toString(), requestConfig);
    const searchResults = searchResponse.data?.query?.search;

    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const title = searchResults[0].title;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryResponse = await axios.get(summaryUrl, requestConfig);
    const pageData = summaryResponse.data;

    if (pageData.type === 'disambiguation') {
      return null;
    }

    const resultPayload = {
      title,
      summary: pageData.extract || 'Summary not available.',
      pdfLink: `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`
    };

    wikipediaCache.set(trimmedQuery, resultPayload);
    return resultPayload;
  } catch (error) {
    console.error('Wikipedia API error:', error.message);
    return null;
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text?.trim();

  // Keep the current private-chat-only behaviour.
  if (msg.chat.type !== 'private' || !messageText) {
    return;
  }

  if (messageText === '/start') {
    const welcomeMessage = [
      '<b>Welcome to Research PDF Bot</b>',
      '',
      'Send an English keyword or topic name to receive a Wikipedia summary and its PDF link.',
      '',
      'Use /language to view the active search language.'
    ].join('\n');

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText === '/language') {
    await bot.sendMessage(chatId, 'Current search language: English Wikipedia.', { parse_mode: 'HTML' });
    return;
  }

  if (messageText.startsWith('/')) {
    return;
  }

  let processingMessageId = null;

  try {
    const processingMessage = await bot.sendMessage(chatId, 'Searching Wikipedia...');
    processingMessageId = processingMessage.message_id;

    const result = await getWikipediaPDFContent(messageText);

    if (processingMessageId) {
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});
    }

    if (!result) {
      await bot.sendMessage(
        chatId,
        '<b>No matching record found.</b>\n\nPlease check the spelling and try an English search term.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    let replyText = [
      `<b>${escapeHtml(result.title)}</b>`,
      '',
      escapeHtml(result.summary),
      '',
      `<a href="${result.pdfLink}">Download PDF File</a>`
    ].join('\n');

    if (replyText.length > 4096) {
      replyText = `${replyText.slice(0, 4080)}...`;
    }

    await bot.sendMessage(chatId, replyText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('Message dispatcher error:', error.message);

    if (processingMessageId) {
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});
    }

    await bot.sendMessage(
      chatId,
      '<b>System error.</b>\n\nPlease try again in a moment.',
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

console.log('Telegram Wikipedia PDF Bot started successfully.');
    
