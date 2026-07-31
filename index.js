/**
 * Telegram Document Search Bot - Stealth Puppeteer Implementation
 * Based on GitHub open-source stealth practices
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const NodeCache = require('node-cache');

// Apply Stealth Plugin to bypass basic bot detections
puppeteer.use(StealthPlugin());

const dokumenCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

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

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot service is running.\n');
}).listen(PORT, () => {
  console.log(`Keep-Alive server active on port ${PORT}`);
});

bot.setMyCommands([
  { command: 'start', description: 'Initialize bot' },
  { command: 'help', description: 'Help instructions' }
]).catch((err) => console.error('Command registration error:', err.message));

async function scrapeWithStealthBrowser(query) {
  let browser = null;
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    if (dokumenCache.has(trimmedQuery.toLowerCase())) {
      return dokumenCache.get(trimmedQuery.toLowerCase());
    }

    console.log(`Launching Stealth Puppeteer for: "${trimmedQuery}"`);

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
    
    const searchUrl = `https://dokumen.pub/search?q=${encodeURIComponent(trimmedQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const documents = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a');
      
      links.forEach(a => {
        const href = a.getAttribute('href');
        const text = a.innerText.trim();
        
        if (href && href.endsWith('.html') && !href.includes('/search') && text.length > 5) {
          let fullLink = href.startsWith('http') ? href : `https://dokumen.pub${href}`;
          if (!results.some(doc => doc.link === fullLink)) {
            results.push({ title: text, link: fullLink });
          }
        }
      });

      return results.slice(0, 5);
    });

    await browser.close();

    if (!documents || documents.length === 0) return null;

    dokumenCache.set(trimmedQuery.toLowerCase(), documents);
    return documents;

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('Stealth Scraper Error:', error.message);
    return null;
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type !== 'private' || !messageText) return;

  if (messageText === '/start') {
    return bot.sendMessage(chatId, `👋 Welcome! Send any document or book title to search via Stealth engine.`);
  }

  if (messageText.startsWith('/')) return;

  let processingMsgId = null;
  try {
    const processingMsg = await bot.sendMessage(chatId, '⏳ Searching documents using stealth mode...');
    processingMsgId = processingMsg.message_id;

    const results = await scrapeWithStealthBrowser(messageText);

    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }

    if (results && results.length > 0) {
      let replyText = `📄 *Stealth Results for:* \`${messageText}\`\n\n`;
      results.forEach((item, index) => {
        replyText += `*${index + 1}.* [${item.title}](${item.link})\n\n`;
      });

      await bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
      await bot.sendMessage(chatId, `❌ *Blocked or Not Found*\n\nCloudflare security triggered or no documents matched.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    if (processingMsgId) {
      await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
    }
    bot.sendMessage(chatId, `⚠️ *System Error occurred.*`);
  }
});

console.log('Stealth Document Search Bot initialized...');
