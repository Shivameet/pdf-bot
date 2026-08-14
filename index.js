const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const NodeCache = require('node-cache');

const wikipediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const MAX_PDF_BYTES = 48 * 1024 * 1024;

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

function makeFileName(title) {
  const cleanedTitle = String(title)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 100);

  return `${cleanedTitle || 'wikipedia_article'}.pdf`;
}

function getRequestConfig() {
  return {
    headers: {
      'User-Agent': 'TelegramResearchBot/2.1 (contact: your-email@example.com)'
    },
    timeout: 30000
  };
}

async function getWikipediaContent(query) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return null;
  }

  if (wikipediaCache.has(trimmedQuery)) {
    console.log(`Cache hit for query: "${trimmedQuery}"`);
    return wikipediaCache.get(trimmedQuery);
  }

  try {
    console.log(`Searching Wikipedia for: "${trimmedQuery}"`);

    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', trimmedQuery);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('format', 'json');

    const searchResponse = await axios.get(searchUrl.toString(), getRequestConfig());
    const searchResults = searchResponse.data?.query?.search;

    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const title = searchResults[0].title;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryResponse = await axios.get(summaryUrl, getRequestConfig());
    const pageData = summaryResponse.data;

    if (pageData.type === 'disambiguation') {
      return null;
    }

    const result = {
      title,
      summary: pageData.extract || 'Summary not available.',
      pdfUrl: `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`
    };

    wikipediaCache.set(trimmedQuery, result);
    return result;
  } catch (error) {
    console.error('Wikipedia API error:', error.message);
    return null;
  }
}

async function downloadWikipediaPdf(pdfUrl) {
  const response = await axios.get(pdfUrl, {
    ...getRequestConfig(),
    responseType: 'arraybuffer',
    maxContentLength: MAX_PDF_BYTES,
    maxBodyLength: MAX_PDF_BYTES
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const fileBuffer = Buffer.from(response.data);

  if (!contentType.includes('application/pdf')) {
    throw new Error('Wikipedia did not return a PDF file.');
  }

  if (!fileBuffer.length) {
    throw new Error('The PDF file was empty.');
  }

  if (fileBuffer.length > MAX_PDF_BYTES) {
    throw new Error('The PDF is too large to send through this bot.');
  }

  return fileBuffer;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text?.trim();

  if (msg.chat.type !== 'private' || !messageText) {
    return;
  }

  if (messageText === '/start') {
    const welcomeMessage = [
      '<b>Welcome to Research PDF Bot</b>',
      '',
      'Send an English keyword or topic name.',
      'The bot will send the Wikipedia summary and the PDF as a Telegram document file.',
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
    const processingMessage = await bot.sendMessage(chatId, 'Searching Wikipedia and preparing the PDF file...');
    processingMessageId = processingMessage.message_id;

    const result = await getWikipediaContent(messageText);

    if (!result) {
      if (processingMessageId) {
        await bot.deleteMessage(chatId, processingMessageId).catch(() => {});
      }

      await bot.sendMessage(
        chatId,
        '<b>No matching record found.</b>\n\nPlease check the spelling and try an English search term.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    let summaryText = [
      `<b>${escapeHtml(result.title)}</b>`,
      '',
      escapeHtml(result.summary),
      '',
      'The PDF document is being sent below.'
    ].join('\n');

    if (summaryText.length > 4096) {
      summaryText = `${summaryText.slice(0, 4080)}...`;
    }

    await bot.sendMessage(chatId, summaryText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    const pdfBuffer = await downloadWikipediaPdf(result.pdfUrl);

    await bot.sendDocument(
      chatId,
      pdfBuffer,
      {
        caption: `<b>${escapeHtml(result.title)}</b>\nWikipedia PDF document`,
        parse_mode: 'HTML'
      },
      {
        filename: makeFileName(result.title),
        contentType: 'application/pdf'
      }
    );

    if (processingMessageId) {
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});
    }
  } catch (error) {
    console.error('Message dispatcher error:', error.message);

    if (processingMessageId) {
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});
    }

    const userMessage = error.message.includes('too large')
      ? '<b>PDF file is too large.</b>\n\nPlease try a shorter topic or another article.'
      : '<b>PDF could not be sent.</b>\n\nPlease try again in a moment.';

    await bot.sendMessage(chatId, userMessage, { parse_mode: 'HTML' }).catch(() => {});
  }
});

console.log('Telegram Wikipedia Direct PDF Bot started successfully.');
      
