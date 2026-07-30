/**
 * Production-Ready Telegram Dokumen.pub Scraper Bot
 * Featuring Cheerio HTML Parsing, TTL Caching & Polling Conflict Fix
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

// Initialize Cache with 24 hours TTL (86400 seconds)
const dokumenCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

// ==========================================
// Phase 1: Core Infrastructure & Stability
// ==========================================
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('CRITICAL: BOT_TOKEN is missing in environment variables.');
  process.exit(1);
}

// Fixed polling option to automatically handle conflict terminations
const bot = new TelegramBot(TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  } 
});

// Global Error Boundaries
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Lightweight HTTP Keep-Alive Server for Cloud Uptime (Render)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot service is running.\n');
}).listen(PORT, () => {
  console.log(`Keep-Alive server active on port ${PORT}`);
});

// ==========================================
// Phase 2: Navigation & Command Registrations
// ==========================================
bot.setMyCommands([
  { command: 'start', description: 'Initialize bot and view onboarding instructions' },
  { command: 'help', description: 'How to use Dokumen search bot' }
]).catch((err) => console.error('Failed to register commands:', err.message));

// ==========================================
// Phase 3: Dokumen.pub Scraper Engine with Caching
// ==========================================
async function searchDokumenDocuments(query) {
  try {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return null;

    if (dokumenCache.has(trimmedQuery)) {
      console.log(`Cache Hit for query: "${trimmedQuery}"`);
      return dokumenCache.get(trimmedQuery);
    }

    console.log(`Cache Miss. Scraping Dokumen.pub for: "${trimmedQuery}"`);

    const headersConfig = {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://dokumen.pub/'
      },
      timeout: 10000
    };

    const searchUrl = `https://dokumen.pub/search?q=${encodeURIComponent(trimmedQuery)}`;
    const response = await axios.get(searchUrl, headersConfig);
    
    const $ = cheerio.load(response.data);
    const documents = [];

    $('a').each((index, element) => {
      if (documents.length >= 5) return;

      const href = $(element).attr('href');
      const text = $(element).text().trim();

      if (href && href.startsWith('/') && href.length > 5 && text.length > 10) {
        if (!documents.some(doc => doc.link === `https://dokumen.pub${href}`)) {
          documents.push({
            title: text,
            link: `https://dokumen.pub${href}`
          });
        }
      }
    });

    if (documents.length === 0) return null;

    dokumenCache.set(trimmedQuery, documents);
    return documents;

  } catch (error) {
    console.error('Dokumen Scraper Exception:', error.message);
    return null;
  }
}

// ==========================================
// Phase 4: Message Dispatcher & Layout Engine
// ==========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type !== 'private' || !messageText) return;

  if (messageText === '/start') {
    const welcomeMsg = 
      `👋 *Welcome to Dokumen Search Bot*\n\n` +
      `📚 Send any book name, topic, or document title to search and get direct download links.\n\n` +
      `💡 *Example:* Type \`python programming\` or \`java notes\`.`;
    
    return bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' }).catch(() => {});
  }

  if (messageText === '/help') {
    return bot.sendMessage(chatId, `📖 Just type your book or document name, and the bot will fetch the best matching links for you.`, { parse_mode: 'Markdown' }).catch(() => {});
  }

  if (messageText.startsWith('/')) return;

  let processingMsgId = null;
  try {
    const processingMsg = await bot.sendMessage(chatId, '⏳ Searching dokumen.pub database...');
    processingMsgId = processingMsg.message_id;

    const results = await searchDokumenDocuments(messageText);

    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }

    if (results && results.length > 0) {
      let replyText = `📄 *Search Results for:* \`${messageText}\`\n\n`;
      
      results.forEach((item, index) => {
        replyText += `*${index + 1}.* [${item.title}](${item.link})\n\n`;
      });

      if (replyText.length > 4096) {
        replyText = replyText.substring(0, 4090) + '...';
      }

      await bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
      await bot.sendMessage(chatId, `❌ *No Documents Found*\n\nCould not find any matching documents on dokumen.pub for your query.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Dispatcher Error:', error.message);
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }
    bot.sendMessage(chatId, `⚠️ *System Error*\n\nFailed to fetch documents. Please try again later.`, { parse_mode: 'Markdown' }).catch(() => {});
  }
});

console.log('Dokumen Scraper Bot successfully initialized...');
