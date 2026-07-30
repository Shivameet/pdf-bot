/**
 * ============================================================================
 * Production-Ready Telegram Wikipedia PDF Downloader Bot
 * ============================================================================
 * * Architecture Specifications:
 * - Framework: node-telegram-bot-api (Long Polling Engine)
 * - Network Engine: Axios (REST & MediaWiki Action API integration)
 * - Infrastructure: Native HTTP Keep-Alive Server (Optimized for Render/PaaS deployment)
 * - Fault Tolerance: Global exception guards & non-blocking asynchronous wrappers
 * ============================================================================
 */

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

// Environment Token Validation
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('CRITICAL ERROR: BOT_TOKEN is missing in environment variables.');
  process.exit(1);
}

// Initialize Telegram Bot Instance
const bot = new TelegramBot(TOKEN, { polling: true });

// ============================================================================
// 1. Process Guard & Unhandled Error Boundaries
// ============================================================================
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception Boundary Triggered:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection Boundary Triggered:', reason);
});

// ============================================================================
// 2. Keep-Alive HTTP Server (Cloud Hosting Uptime Protection)
// ============================================================================
const SERVER_PORT = process.env.PORT || 3000;
const keepAliveServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot service is running and active.\n');
});

keepAliveServer.listen(SERVER_PORT, () => {
  console.log(`HTTP Keep-Alive server successfully bound to port ${SERVER_PORT}`);
});

// ============================================================================
// 3. Command Registrations (Persistent Client Navigation)
// ============================================================================
bot.setMyCommands([
  { command: 'start', description: 'Initialize the bot and show instructions' },
  { command: 'help', description: 'View formatting guidelines and search tips' }
]).catch((err) => console.error('Failed to set commands:', err.message));

// ============================================================================
// 4. Wikipedia Search & PDF Export Engine
// ============================================================================
async function fetchWikipediaContent(query) {
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    // Step A: Resolve query to official Wikipedia page title via MediaWiki Action API
    const searchEndpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmedQuery)}&srlimit=1&format=json`;
    const searchResponse = await axios.get(searchEndpoint, {
      headers: { 'User-Agent': 'TelegramResearchBot/2.0 (Production)' },
      timeout: 8000
    });

    const searchHits = searchResponse.data?.query?.search;
    if (!searchHits || searchHits.length === 0) {
      return null;
    }

    const officialTitle = searchHits[0].title;

    // Step B: Retrieve official extract summary via Wikipedia REST API
    const summaryEndpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(officialTitle)}`;
    const summaryResponse = await axios.get(summaryEndpoint, {
      headers: { 'User-Agent': 'TelegramResearchBot/2.0 (Production)' },
      timeout: 8000
    });

    const pageData = summaryResponse.data;
    if (pageData.type === 'disambiguation') {
      return null; // Reject ambiguous multi-match topics for data precision
    }

    const summaryText = pageData.extract || 'Summary content is currently unavailable for this entry.';
    const thumbnailSource = pageData.thumbnail ? pageData.thumbnail.source : null;

    // Step C: Construct official dynamic REST PDF export link
    const exportPdfUrl = `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(officialTitle)}`;

    return {
      title: officialTitle,
      summary: summaryText,
      thumbnail: thumbnailSource,
      pdfLink: exportPdfUrl
    };

  } catch (error) {
    console.error(`Wikipedia Resolver Exception [${query}]:`, error.message);
    return null;
  }
}

// ============================================================================
// 5. Message Event Dispatcher & UI Handler
// ============================================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  // Process exclusively private chat interactions
  if (msg.chat.type !== 'private') return;

  // Filter out empty payloads or unrecognized parameters
  if (!messageText) return;

  // Handle Command: /start
  if (messageText === '/start') {
    const onboardingText = 
      `👋 *Welcome to Research PDF Bot*\n\n` +
      `🤖 Send any keyword or subject name to instantly generate a summarized overview along with a professional **PDF Download Card**.\n\n` +
      `⚠️ *Tip:* Utilize English search keywords for optimal indexing results.`;

    return bot.sendMessage(chatId, onboardingText, { parse_mode: 'Markdown' })
      .catch((err) => console.error('Start command delivery failure:', err.message));
  }

  // Handle Command: /help
  if (messageText === '/help') {
    const helpText = 
      `📖 *Operational Guidelines*\n\n` +
      `1. Type clear search terms (e.g., *Quantum Computing*, *Narendra Modi*).\n` +
      `2. Wait a moment while the engine queries live database indices.\n` +
      `3. Tap the *[Download PDF File]* link in the rendered card to export document materials instantly.`;

    return bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' })
      .catch((err) => console.error('Help command delivery failure:', err.message));
  }

  // Ignore raw command structures other than handled items
  if (messageText.startsWith('/')) return;

  let processingIndicatorId = null;

  try {
    // Dispatch active status notification
    const processingMessage = await bot.sendMessage(chatId, '⏳ Querying database and compiling document parameters...');
    processingIndicatorId = processingMessage.message_id;

    // Execute data resolution pipeline
    const resolvedRecord = await fetchWikipediaContent(messageText);

    // Purge processing status notification safely
    if (processingIndicatorId) {
      await bot.deleteMessage(chatId, processingIndicatorId).catch(() => {});
    }

    if (resolvedRecord) {
      // Format text payload inside rigorous Markdown constraints (1024-character caption safe limit bounds)
      let formattedOutput = `📄 *${resolvedRecord.title}*\n\n`;
      formattedOutput += `${resolvedRecord.summary}\n\n`;
      formattedOutput += `📥 [Download PDF File](${resolvedRecord.pdfLink})`;

      if (formattedOutput.length > 1024) {
        formattedOutput = formattedOutput.substring(0, 1020) + '...';
      }

      const formattingOptions = { parse_mode: 'Markdown' };

      // Deliver via sendPhoto with integrated caption container or fallback to standard text message
      if (resolvedRecord.thumbnail) {
        await bot.sendPhoto(chatId, resolvedRecord.thumbnail, {
          caption: formattedOutput,
          ...formattingOptions
        }).catch(async () => {
          await bot.sendMessage(chatId, formattedOutput, formattingOptions);
        });
      } else {
        await bot.sendMessage(chatId, formattedOutput, formattingOptions);
      }

    } else {
      const errorFeedback = `❌ *No Matching Records Found*\n\nNo verified articles matched your query. Please modify your keywords and try again.`;
      await bot.sendMessage(chatId, errorFeedback, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('Message routing dispatch exception:', error.message);
    
    if (processingIndicatorId) {
      await bot.deleteMessage(chatId, processingIndicatorId).catch(() => {});
    }

    bot.sendMessage(chatId, `⚠️ *System Error Encountered*\n\nAn unexpected processing fault occurred. Please re-attempt your query.`, { parse_mode: 'Markdown' })
       .catch(() => {});
  }
});

console.log('Production-Ready Telegram PDF Bot successfully initialized and polling...');
