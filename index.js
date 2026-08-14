const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const NodeCache = require('node-cache');
const crypto = require('crypto');

const wikipediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const pdfButtonCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
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
  res.end('Research bot is running.\n');
});

server.listen(PORT, () => {
  console.log(`Health-check server is listening on port ${PORT}`);
});

bot.setMyCommands([
  { command: 'start', description: 'Start the research bot' },
  { command: 'help', description: 'Learn how the two search buttons work' }
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
      // Replace this placeholder with your real contact email before production use.
      'User-Agent': 'TelegramResearchBot/3.0 (contact: your-email@example.com)'
    },
    timeout: 30000
  };
}

function createDokumenGoogleSearchUrl(query) {
  const googleQuery = `site:dokumen.pub ${query.trim()}`;
  return `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`;
}

async function getWikipediaContent(query) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return null;
  }

  if (wikipediaCache.has(trimmedQuery)) {
    console.log(`Wikipedia cache hit for query: "${trimmedQuery}"`);
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

function createResultButtons(wikipediaResult, originalQuery) {
  const buttonId = crypto.randomBytes(12).toString('hex');
  pdfButtonCache.set(buttonId, wikipediaResult);

  return {
    inline_keyboard: [
      [
        {
          text: '📥 Wikipedia PDF',
          callback_data: `pdf:${buttonId}`
        }
      ],
      [
        {
          text: '🔍 Search on Dokumen.pub',
          url: createDokumenGoogleSearchUrl(originalQuery)
        }
      ]
    ]
  };
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text?.trim();

  if (msg.chat.type !== 'private' || !messageText) {
    return;
  }

  if (messageText === '/start') {
    const welcomeMessage = [
      '<b>Research Helper Bot</b>',
      '',
      'Send an English topic, book name, or person name.',
      '',
      'You will receive:',
      '1. A Wikipedia title and summary',
      '2. A Wikipedia PDF button that sends the PDF in Telegram',
      '3. A Dokumen.pub button that opens Google results limited to Dokumen.pub'
    ].join('\n');

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText === '/help') {
    const helpMessage = [
      '<b>How the buttons work</b>',
      '',
      '<b>Wikipedia PDF</b>: The bot sends the matching Wikipedia PDF as a Telegram document file.',
      '',
      '<b>Search on Dokumen.pub</b>: Google opens with results limited to Dokumen.pub for the same topic.'
    ].join('\n');

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText.startsWith('/')) {
    return;
  }

  let processingMessageId = null;

  try {
    const processingMessage = await bot.sendMessage(chatId, 'Searching Wikipedia...');
    processingMessageId = processingMessage.message_id;

    const wikipediaResult = await getWikipediaContent(messageText);

    if (processingMessageId) {
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});
    }

    if (!wikipediaResult) {
      const noWikipediaMessage = [
        '<b>No Wikipedia result was found.</b>',
        '',
        'You can still search the same topic on Dokumen.pub using the button below.'
      ].join('\n');

      await bot.sendMessage(chatId, noWikipediaMessage, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🔍 Search on Dokumen.pub',
              url: createDokumenGoogleSearchUrl(messageText)
            }
          ]]
        }
      });
      return;
    }

    let summaryText = [
      `<b>${escapeHtml(wikipediaResult.title)}</b>`,
      '',
      escapeHtml(wikipediaResult.summary)
    ].join('\n');

    if (summaryText.length > 4096) {
      summaryText = `${summaryText.slice(0, 4080)}...`;
    }

    await bot.sendMessage(chatId, summaryText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: createResultButtons(wikipediaResult, messageText)
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

bot.on('callback_query', async (callbackQuery) => {
  const callbackData = callbackQuery.data || '';
  const chatId = callbackQuery.message?.chat?.id;

  if (!chatId || !callbackData.startsWith('pdf:')) {
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    return;
  }

  const buttonId = callbackData.slice(4);
  const wikipediaResult = pdfButtonCache.get(buttonId);

  if (!wikipediaResult) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: 'This PDF button has expired. Please search for the topic again.',
      show_alert: true
    }).catch(() => {});
    return;
  }

  await bot.answerCallbackQuery(callbackQuery.id, {
    text: 'Preparing your Wikipedia PDF...'
  }).catch(() => {});

  let statusMessageId = null;

  try {
    const statusMessage = await bot.sendMessage(chatId, 'Preparing the Wikipedia PDF document...');
    statusMessageId = statusMessage.message_id;

    const pdfBuffer = await downloadWikipediaPdf(wikipediaResult.pdfUrl);

    await bot.sendDocument(
      chatId,
      pdfBuffer,
      {
        caption: `<b>${escapeHtml(wikipediaResult.title)}</b>\nWikipedia PDF document`,
        parse_mode: 'HTML'
      },
      {
        filename: makeFileName(wikipediaResult.title),
        contentType: 'application/pdf'
      }
    );

    if (statusMessageId) {
      await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
    }
  } catch (error) {
    console.error('Wikipedia PDF error:', error.message);

    if (statusMessageId) {
      await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
    }

    const userMessage = error.message.includes('too large')
      ? '<b>Wikipedia PDF file is too large.</b>\n\nPlease try another article.'
      : '<b>Wikipedia PDF could not be sent.</b>\n\nPlease try again in a moment.';

    await bot.sendMessage(chatId, userMessage, { parse_mode: 'HTML' }).catch(() => {});
  }
});

console.log('Telegram Wikipedia + Dokumen.pub Research Bot started successfully.');
  
