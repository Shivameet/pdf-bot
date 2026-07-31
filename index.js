/**
 * Production-Ready Telegram Document Search Bot
 * Optimized with Direct Dokumen.pub Search URL Generator
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const NodeCache = require('node-cache');

// Initialize Cache with 24 hours TTL
const dokumenCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

// ==========================================
// Core Infrastructure & Stability
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
// Direct Search URL Builder Engine
// ==========================================
async function searchDokumenDocuments(query) {
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    if (dokumenCache.has(trimmedQuery.toLowerCase())) {
      console.log(`Cache Hit for query: "${trimmedQuery}"`);
      return dokumenCache.get(trimmedQuery.toLowerCase());
    }

    console.log(`Generating direct search results for: "${trimmedQuery}"`);

    // Construct direct search link for dokumen.pub which reliably opens search results page
    const directSearchUrl = `https://dokumen.pub/search?q=${encodeURIComponent(trimmedQuery)}`;
    
    const results = [
      {
        title: `🔍 View search results for "${trimmedQuery}" on Dokumen.pub`,
        link: directSearchUrl
      }
    ];

    dokumenCache.set(trimmedQuery.toLowerCase(), results);
    return results;

  } catch (error) {
    console.error('Search Engine Exception:', error.message);
    return null;
  }
}

// ==========================================
// Message Dispatcher & Layout Engine
// ==========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type !== 'private' || !messageText) return;

  if (messageText === '/start') {
    const welcomeMsg = 
      `👋 *Welcome to Document Search Bot*\n\n` +
      `📚 Send any book name, topic, or document title to search and get direct search links.\n\n` +
      `💡 *Example:* Type \`python programming\` or \`java notes\`.`;
    
    return bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' }).catch(() => {});
  }

  if (messageText === '/help') {
    return bot.sendMessage(chatId, `📖 Just type your book or document name, and the bot will fetch the direct search link for you.`, { parse_mode: 'Markdown' }).catch(() => {});
  }

  if (messageText.startsWith('/')) return;

  let processingMsgId = null;
  try {
    const processingMsg = await bot.sendMessage(chatId, '⏳ Generating direct search link...');
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

      replyText += `_Tip: Link par click karke browser mein apni book select karke download karein._`;

      if (replyText.length > 4096) {
        replyText = replyText.substring(0, 4090) + '...';
      }

      await bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
      await bot.sendMessage(chatId, `❌ *No Documents Found*\n\nCould not generate search link. Try a simpler keyword.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Dispatcher Error:', error.message);
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }
    bot.sendMessage(chatId, `⚠️ *System Error*\n\nPlease try again later.`, { parse_mode: 'Markdown' }).catch(() => {});
  }
});

console.log('Document Search Bot successfully initialized...');
