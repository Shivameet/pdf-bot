/**
 * Production-Ready Telegram Wikipedia PDF Bot
 * Architecture Compliant with Approved Checklist
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

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
  res.end('Bot service is running.\n');
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
// Phase 3: Data Retrieval & Parsing Engine
// ==========================================
async function getWikipediaPDFContent(query) {
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    // 1. Resolve exact title via MediaWiki Action API
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmedQuery)}&srlimit=1&format=json`;
    const searchRes = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'ResearchBot/2.0' },
      timeout: 8000
    });
    
    const searchResults = searchRes.data?.query?.search;
    if (!searchResults || searchResults.length === 0) return null;

    const title = searchResults[0].title;
    
    // 2. Fetch clean summary via REST API
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await axios.get(summaryUrl, {
      headers: { 'User-Agent': 'ResearchBot/2.0' },
      timeout: 8000
    });

    const pageData = summaryRes.data;
    if (pageData.type === 'disambiguation') return null;

    const extract = pageData.extract || "Summary not available.";
    
    // 3. Construct native Green PDF Card link format
    const pdfUrl = `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    return {
      title: title,
      summary: extract,
      pdfLink: pdfUrl
    };
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

    // Execute data resolution
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

console.log('Production PDF Bot successfully initialized...');
