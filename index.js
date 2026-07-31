/**
 * Production-Ready Telegram Document Search Bot
 * Featuring Official DuckDuckGo JSON API & Webhook Conflict Resolver
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
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

// Lightweight HTTP Keep-Alive Server for Render Uptime
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
// Phase 3: Official DuckDuckGo API Search Engine
// ==========================================
async function searchDokumenDocuments(query) {
  try {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return null;

    if (dokumenCache.has(trimmedQuery)) {
      console.log(`Cache Hit for query: "${trimmedQuery}"`);
      return dokumenCache.get(trimmedQuery);
    }

    console.log(`Cache Miss. Searching documents via API for: "${trimmedQuery}"`);

    // Using DuckDuckGo Instant Answer / API endpoint for direct results
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmedQuery + ' dokumen.pub')}&format=json&no_html=1&skip_disambig=1`;
    
    const response = await axios.get(searchUrl, { timeout: 10000 });
    const data = response.data;
    const documents = [];

    // 1. Check RelatedTopics from DuckDuckGo API
    if (data && data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.forEach(item => {
        if (documents.length >= 5) return;
        if (item.FirstURL && item.Text) {
          let link = item.FirstURL;
          let title = item.Text;
          if (link.includes('dokumen.pub') && !documents.some(doc => doc.link === link)) {
            documents.push({ title, link });
          }
        }
      });
    }

    // 2. If no direct results found in API, fallback to DuckDuckGo HTML API parser
    if (documents.length === 0) {
      const fallbackUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmedQuery + ' site:dokumen.pub')}`;
      const htmlRes = await axios.get(fallbackUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      const cheerio = require('cheerio');
      const $ = cheerio.load(htmlRes.data);

      $('.result').each((index, element) => {
        if (documents.length >= 5) return;
        const titleEl = $(element).find('.result__title a');
        const urlEl = $(element).find('.result__url');
        
        let title = titleEl.text().trim();
        let rawLink = urlEl.attr('href') || titleEl.attr('href');

        if (rawLink) {
          let actualLink = rawLink;
          if (rawLink.includes('uddg=')) {
            try {
              const match = rawLink.match(/uddg=([^&]+)/);
              if (match && match[1]) {
                actualLink = decodeURIComponent(match[1]);
              }
            } catch (e) {}
          }

          if (actualLink.includes('dokumen.pub') && !documents.some(doc => doc.link === actualLink)) {
            documents.push({ title: title || actualLink, link: actualLink });
          }
        }
      });
    }

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
