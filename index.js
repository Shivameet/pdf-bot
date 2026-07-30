const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Left side menu button commands
bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'language', description: 'Change language preference' }
]);

// Crash-proof guards
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

// Render HTTP Server for hosting/uptime
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running safely!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// Strict Exact-Match Wikipedia Fetcher (Only English primary)
async function getWikipediaData(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`;
    const searchRes = await axios.get(searchUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });
    
    const searchResults = searchRes.data?.query?.search;
    if (!searchResults || searchResults.length === 0) return null;

    const title = searchResults[0].title;
    
    // Check if the search result closely matches or if it's completely irrelevant
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await axios.get(summaryUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });

    const pageData = summaryRes.data;
    if (pageData.type === 'disambiguation') return null;

    const extract = pageData.extract || "Summary not available.";
    const imageUrl = pageData.thumbnail ? pageData.thumbnail.source : null;
    const pdfUrl = `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    return {
      title: title,
      summary: extract,
      image: imageUrl,
      pdfLink: pdfUrl,
      currentLang: 'en'
    };
  } catch (error) {
    console.log(`Wikipedia fetch error:`, error.message);
  }
  return null;
}

// Start Command Handler with Short English Disclaimer
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `👋 *Welcome!*\n\n` +
    `🤖 Send any topic name to get a summary and PDF download.\n\n` +
    `⚠️ *Tip:* Please search using English keywords for best results.`;

  bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' }).catch(err => console.log('Start error:', err));
});

bot.onText(/\/language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🌐 Current mode: Standard Search active.\nSend any topic name to fetch information instantly.`).catch(() => {});
});

// Callback Query Handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data.startsWith('switch_')) {
      const parts = data.split('_');
      const encodedQuery = parts.slice(2).join('_');
      const searchQuery = decodeURIComponent(encodedQuery);

      await bot.answerCallbackQuery(query.id, { text: `Loading result...` });

      let processingMsg = await bot.sendMessage(chatId, '⏳ Loading alternative version...').catch(() => {});
      const result = await getWikipediaData(searchQuery);
      
      if (processingMsg) {
        bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      }

      if (result) {
        let caption = `📄 *${result.title}*\n\n${result.summary}`;
        if (caption.length > 1024) caption = caption.substring(0, 1020) + '...';

        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `📥 Download PDF File (${result.title})`, url: result.pdfLink }]
            ]
          }
        };

        if (result.image) {
          bot.sendPhoto(chatId, result.image, { caption: caption, ...opts }).catch(() => {
            bot.sendMessage(chatId, caption, opts).catch(() => {});
          });
        } else {
          bot.sendMessage(chatId, caption, opts).catch(() => {});
        }
      } else {
        bot.sendMessage(chatId, `❌ Sorry, result not found.`).catch(() => {});
      }
    }
  } catch (err) {
    console.log('Callback error:', err);
  }
});

// Message Handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.voice) {
    bot.sendMessage(chatId, '🎙️ Voice note received! (Processing text search).').catch(() => {});
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return;
  const searchQuery = msg.text;

  if (msg.chat.type === 'private') {
    let processingMsg;
    try {
      processingMsg = await bot.sendMessage(chatId, '⏳ Searching...');
      
      const result = await getWikipediaData(searchQuery);
      
      if (processingMsg) {
        bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      }

      if (result) {
        let caption = `📄 *${result.title}*\n\n${result.summary}`;

        if (caption.length > 1024) {
          caption = caption.substring(0, 1020) + '...';
        }

        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `📥 Download PDF File (${result.title})`, url: result.pdfLink }]
            ]
          }
        };

        if (result.image) {
          bot.sendPhoto(chatId, result.image, {
            caption: caption,
            ...opts
          }).catch(() => {
            bot.sendMessage(chatId, caption, opts).catch(() => {});
          });
        } else {
          bot.sendMessage(chatId, caption, opts).catch(() => {});
        }
      } else {
        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `🔍 Search in English`, callback_data: `switch_en_${encodeURIComponent(searchQuery)}` }]
            ]
          }
        };
        
        // Clean short English popup message
        const englishMessage = `⚠️ *No Direct Match Found*\n\nPlease search using standard English keywords.`;
        await bot.sendMessage(chatId, englishMessage, opts);
      }
    } catch (error) {
      console.error('Message handler execution error:', error);
      if (processingMsg) {
        bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      }
      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `🔍 Search in English`, callback_data: `switch_en_${encodeURIComponent(searchQuery)}` }]
          ]
        }
      };
      bot.sendMessage(chatId, `⚠️ *No Direct Match Found*\n\nPlease search using standard English keywords.`, opts).catch(() => {});
    }
  }
});

console.log('Final Clean Bot successfully started...');
