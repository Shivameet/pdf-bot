/**
 * Production-Ready Telegram Wikipedia PDF Bot
 * Featuring Professional User-Agent & 24-Hour In-Memory TTL Caching
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const NodeCache = require('node-cache');

// Initialize Cache with 24 hours TTL (86400 seconds)
// checkperiod: 600 seconds par expired items automatically cleanup honge
const wikipediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

// ==========================================
// Phase 1: Core Infrastructure & Stability
// ==========================================
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('CRITICAL: BOT_TOKEN is missing in environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Global Error Boundaries to prevent process termination
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
  res.end('Bot service is running.\n').listen(PORT);
}).listen(PORT, () => {
  console.log(`Keep-Alive server active on port ${PORT}`);
});

// ==========================================
// Phase 2: Navigation & Command Registrations
// ==========================================
bot.setMyCommands([
  { command: 'start', description: 'Initialize bot and view onboarding instructions' },
  { command: 'language', description: 'View active search engine language configuration' }
]).catch((err) => console.error('Failed to register commands:', err.message));

// ==========================================
// Phase 3: Data Retrieval & Parsing Engine with Caching
// ==========================================
async function getWikipediaPDFContent(query) {
  try {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return null;

    // 1. Check if result already exists in RAM Cache
    if (wikipediaCache.has(trimmedQuery)) {
      console.log(`Cache Hit for query: "${trimmedQuery}"`);
      return wikipediaCache.get(trimmedQuery);
    }

    console.log(`Cache Miss. Fetching fresh data from Wikipedia for: "${trimmedQuery}"`);

    // Professional User-Agent compliant with Wikimedia guidelines
    const headersConfig = {
      headers: { 
        'User-Agent': 'TelegramResearchBot/2.0 (https://github.com/bot-owner; contact@bot.com)' 
      },
      timeout: 8000
    };

    // 2. Resolve exact title via MediaWiki Action API
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmedQuery)}&srlimit=1&format=json`;
    const searchRes = await axios.get(searchUrl, headersConfig);
    
    const searchResults = searchRes.data?.query?.search;
    if (!searchResults || searchResults.length === 0) return null;

    const title = searchResults[0].title;
    
    // 3. Fetch clean summary via REST API
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await axios.get(summaryUrl, headersConfig);

    const pageData = summaryRes.data;
    if (pageData.type === 'disambiguation') return null;

    const extract = pageData.extract || "Summary not available.";
    
    // 4. Construct native Green PDF Card link format
    const pdfUrl = `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    const resultPayload = {
      title: title,
      summary: extract,
      pdfLink: pdfUrl
    };

    // 5. Store fetched result into Cache for future requests (24 hours expiry)
    wikipediaCache.set(trimmedQuery, resultPayload);

    return resultPayload;
  } catch (error) {
    console.error('Wikipedia API Exception:', error.message);
    return null;
  }
}

// ==========================================
// Phase 4: Message Dispatcher & Layout Engine
// ==========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  // Enforce private chat scope & validate payload
  if (msg.chat.type !== 'private' || !messageText) return;

  // Command: /start
  if (messageText === '/start') {
    const welcomeMsg = 
      `👋 *Welcome to Research PDF Bot*\n\n` +
      `🤖 Send any keyword or subject name to generate a summary and professional PDF download card.\n\n` +
      `⚠️ *Tip:* Use English search keywords for optimal results.`;
    
    return bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' }).catch(() => {});
  }

  // Command: /language
  if (messageText === '/language') {
    return bot.sendMessage(chatId, `🌐 Current mode: English Wikipedia Search active.`, { parse_mode: 'Markdown' }).catch(() => {});
  }

  // Ignore unrecognized commands
  if (messageText.startsWith('/')) return;

  let processingMsgId = null;
  try {
    // Visual Feedback: Temporary loading state notification
    const processingMsg = await bot.sendMessage(chatId, '⏳ Searching database...');
    processingMsgId = processingMsg.message_id;

    // Execute data resolution (checks cache first, then API)
    const result = await getWikipediaPDFContent(messageText);

    // Purge loading indicator
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }

    if (result) {
      // Build unified text layout payload for native Green PDF Card rendering
      let replyText = `📄 *${result.title}*\n\n`;
      replyText += `${result.summary}\n\n`;
      replyText += `📥 [Download PDF File](${result.pdfLink})`;

      if (replyText.length > 4096) {
        replyText = replyText.substring(0, 4090) + '...';
      }

      await bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `❌ *No Matching Records Found*\n\nPlease check your keywords and try again.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Dispatcher Error:', error.message);
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }
    bot.sendMessage(chatId, `⚠️ *System Error*\n\nFailed to process your request. Please try again.`, { parse_mode: 'Markdown' }).catch(() => {});
  }
});

console.log('Production PDF Bot successfully initialized with TTL Cache & User-Agent...');
