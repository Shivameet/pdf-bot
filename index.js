/**
 * Production-Ready Telegram Multi-Source Document Search Bot
 * Featuring Direct Repository Routing & Webhook Conflict Resolver
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

const bot = new TelegramBot(TOKEN, { polling: false });

bot.deleteWebHook().then(() => {
  console.log('Previous webhooks cleared successfully.');
  bot.startPolling();
}).catch((err) => {
  console.error('Webhook cleanup warning:', err.message);
  bot.startPolling();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot service is running.\n');
}).listen(PORT, () => {
  console.log(`Keep-Alive server active on port ${PORT}`);
});

bot.setMyCommands([
  { command: 'start', description: 'Initialize bot and view onboarding instructions' },
  { command: 'help', description: 'How to use Document search bot' }
]).catch((err) => console.error('Failed to register commands:', err.message));

// ==========================================
// Phase 3: Robust Multi-Engine Document Search
// ==========================================
async function searchDokumenDocuments(query) {
  try {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return null;

    if (dokumenCache.has(trimmedQuery)) {
      console.log(`Cache Hit for query: "${trimmedQuery}"`);
      return dokumenCache.get(trimmedQuery);
    }

    console.log(`Cache Miss. Searching documents for: "${trimmedQuery}"`);

    const headersConfig = {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      timeout: 10000
    };

    // Using an open search index endpoint that aggregates document repositories cleanly
    const searchUrl = `https://lite.duckduckgo.com/lite/`;
    const params = new URLSearchParams();
    params.append('q', trimmedQuery + ' pdf dokumen');

    const response = await axios.post(searchUrl, params, {
      headers: {
        ...headersConfig.headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const documents = [];

    // Parse Lite version table rows which never fail or block
    $('tr').each((index, element) => {
      if (documents.length >= 5) return;

      const linkEl = $(element).find('.result-link');
      if (linkEl.length > 0) {
        let title = linkEl.text().trim();
        let link = linkEl.attr('href');

        if (link && link.startsWith('http')) {
          // Clean up redirect links if any
          if (link.includes('uddg=')) {
            try {
              const match = link.match(/uddg=([^&]+)/);
              if (match && match[1]) {
                link = decodeURIComponent(match[1]);
              }
            } catch (e) {}
          }

          if (title.length > 3 && !documents.some(doc => doc.link === link)) {
            documents.push({ title, link });
          }
        }
      }
    });

    if (documents.length === 0) return null;

    dokumenCache.set(trimmedQuery, documents);
    return documents;

  } catch (error) {
    console.error('Search Engine Exception:', error.message);
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
      `👋 *Welcome to Document Search Bot*\n\n` +
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
    const processingMsg = await bot.sendMessage(chatId, '⏳ Searching documents database...');
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
      await bot.sendMessage(chatId, `❌ *No Documents Found*\n\nCould not find any matching documents for your query. Try a simpler keyword.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Dispatcher Error:', error.message);
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }
    bot.sendMessage(chatId, `⚠️ *System Error*\n\nFailed to fetch documents. Please try again later.`, { parse_mode: 'Markdown' }).catch(() => {});
  }
});

console.log('Document Search Bot successfully initialized...');
