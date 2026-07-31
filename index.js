/**
 * Production-Ready Telegram Dokumen Puppeteer Scraper Bot
 * Directly Scrapes Search Results from Dokumen.pub bypassing restrictions
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const puppeteer = require('puppeteer');
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
// Puppeteer Scraper Engine for Dokumen.pub
// ==========================================
async function searchDokumenDocuments(query) {
  let browser = null;
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    if (dokumenCache.has(trimmedQuery.toLowerCase())) {
      console.log(`Cache Hit for query: "${trimmedQuery}"`);
      return dokumenCache.get(trimmedQuery.toLowerCase());
    }

    console.log(`Launching Puppeteer Browser to scrape Dokumen.pub for: "${trimmedQuery}"`);

    // Launch headless browser optimized for cloud environments
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // Go directly to dokumen.pub search URL format
    const searchUrl = `https://dokumen.pub/search?q=${encodeURIComponent(trimmedQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Extract search result links directly from the page DOM
    const documents = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a');
      
      links.forEach(a => {
        const href = a.getAttribute('href');
        const text = a.innerText.trim();
        
        // Match valid book page links ending with .html
        if (href && href.endsWith('.html') && !href.includes('/search') && text.length > 10) {
          let fullLink = href.startsWith('http') ? href : `https://dokumen.pub${href}`;
          if (!results.some(doc => doc.link === fullLink)) {
            results.push({
              title: text,
              link: fullLink
            });
          }
        }
      });

      return results.slice(0, 5); // Return top 5 matches
    });

    await browser.close();

    if (!documents || documents.length === 0) {
      return null;
    }

    dokumenCache.set(trimmedQuery.toLowerCase(), documents);
    return documents;

  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    console.error('Puppeteer Scraper Exception:', error.message);
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
      `👋 *Welcome to Dokumen Direct Scraper Bot*\n\n` +
      `📚 Send any book name or document title to fetch direct internal links from Dokumen.pub.\n\n` +
      `💡 *Example:* Type \`Indo-Pak War 1971\`.`;
    
    return bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' }).catch(() => {});
  }

  if (messageText === '/help') {
    return bot.sendMessage(chatId, `📖 Just type your book name, and the bot will scrape matching links directly from the website.`, { parse_mode: 'Markdown' }).catch(() => {});
  }

  if (messageText.startsWith('/')) return;

  let processingMsgId = null;
  try {
    const processingMsg = await bot.sendMessage(chatId, '⏳ Scraping Dokumen.pub directly...');
    processingMsgId = processingMsg.message_id;

    const results = await searchDokumenDocuments(messageText);

    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }

    if (results && results.length > 0) {
      let replyText = `📄 *Direct Results from Dokumen.pub for:* \`${messageText}\`\n\n`;
      
      results.forEach((item, index) => {
        replyText += `*${index + 1}.* [${item.title}](${item.link})\n\n`;
      });

      replyText += `_Tip: Direct book link par click karke download karein._`;

      if (replyText.length > 4096) {
        replyText = replyText.substring(0, 4090) + '...';
      }

      await bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
      await bot.sendMessage(chatId, `❌ *No Documents Found*\n\nCould not scrape matching documents from Dokumen.pub for your query.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Dispatcher Error:', error.message);
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }
    bot.sendMessage(chatId, `⚠️ *System Error*\n\nPlease try again later.`, { parse_mode: 'Markdown' }).catch(() => {});
  }
});

console.log('Dokumen Puppeteer Scraper Bot successfully initialized...');
