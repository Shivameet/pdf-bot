const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Left side menu button commands (User requirement: Must stay for easy start/language access)
bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'language', description: 'Change language preference' }
]);

// Crash-proof guards
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

const userLanguages = {};

// Render HTTP Server for hosting/uptime
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running safely!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// Auto Language Detection from typed text
function detectLanguage(text) {
  const hindiRegex = /[\u0900-\u097F]/;
  if (hindiRegex.test(text)) return 'hi';
  return 'en';
}

// Fetch Wikipedia data dynamically based on target language
async function getWikipediaData(query, lang = 'en') {
  try {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`;
    const searchRes = await axios.get(searchUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 10000 });
    
    const searchResults = searchRes.data?.query?.search;
    if (!searchResults || searchResults.length === 0) return null;

    const title = searchResults[0].title;
    
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await axios.get(summaryUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 10000 });

    const pageData = summaryRes.data;
    let extract = pageData.extract || "Summary not available.";
    const imageUrl = pageData.thumbnail ? pageData.thumbnail.source : null;
    
    // Keep summary short (point-to-point: first 2 sentences)
    const sentences = extract.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 2) {
      extract = sentences.slice(0, 2).join(' ');
    }

    const pdfUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    return {
      title: title,
      summary: extract,
      image: imageUrl,
      pdfLink: pdfUrl,
      currentLang: lang
    };
  } catch (error) {
    console.error('API Error:', error.message);
    return null;
  }
}

// Start Command Handler
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `👋 *Welcome!*\n\n` +
    `🤖 *What does this bot do?*\n` +
    `Send any topic name to get a short summary and a prominent direct PDF download.\n` +
    `Bot automatically detects your language, with an option to switch to English instantly!`;

  bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' }).catch(err => console.log('Start error:', err));
});

bot.onText(/\/language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🌐 Current mode: Auto-detection active.\nYou can type in any language (Hindi, French, Spanish, etc.), and you'll get an option to switch to English on every result.`).catch(() => {});
});

// Callback Query Handler for instant English / Native toggle
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data.startsWith('switch_')) {
      const parts = data.split('_');
      const targetLang = parts[1];
      const encodedQuery = parts.slice(2).join('_');
      const searchQuery = decodeURIComponent(encodedQuery);

      await bot.answerCallbackQuery(query.id, { text: `Switching to ${targetLang.toUpperCase()}...` });

      let processingMsg = await bot.sendMessage(chatId, '⏳ Loading alternative version...').catch(() => {});
      
      const result = await getWikipediaData(searchQuery, targetLang);
      
      if (processingMsg) {
        bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      }

      if (result) {
        let caption = `📄 *${result.title}* (${targetLang.toUpperCase()})\n\n${result.summary}`;
        if (caption.length > 1024) caption = caption.substring(0, 1020) + '...';

        // Toggle button logic: if currently English, offer native/Hindi, else offer English
        const alternateLang = targetLang === 'en' ? 'hi' : 'en';
        const alternateLabel = targetLang === 'en' ? '🇮🇳 Read in Hindi' : '🇺🇸 Read in English';

        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `📥 Download PDF File (${result.title})`, url: result.pdfLink }],
              [{ text: alternateLabel, callback_data: `switch_${alternateLang}_${encodeURIComponent(searchQuery)}` }]
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
        bot.sendMessage(chatId, `❌ Sorry, could not find data in ${targetLang.toUpperCase()}.`).catch(() => {});
      }
    }
  } catch (err) {
    console.log('Callback error:', err);
  }
});

// Message Handler for Search (Zero Contradiction, Clean Flow)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.voice) {
    bot.sendMessage(chatId, '🎙️ Voice note received! (Processing text search).').catch(() => {});
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return;
  const searchQuery = msg.text;

  if (msg.chat.type === 'private') {
    // Native auto-detection based on user query
    const detectedLang = detectLanguage(searchQuery);

    let processingMsg;
    try {
      processingMsg = await bot.sendMessage(chatId, '⏳ Searching...');
    } catch (e) {
      return;
    }
    
    const result = await getWikipediaData(searchQuery, detectedLang);
    
    if (processingMsg) {
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
    }

    if (result) {
      let caption = `📄 *${result.title}*\n\n${result.summary}`;

      if (caption.length > 1024) {
        caption = caption.substring(0, 1020) + '...';
      }

      // Dynamic toggle button setup (Native vs English switch)
      const alternateLang = detectedLang === 'en' ? 'hi' : 'en';
      const alternateLabel = detectedLang === 'en' ? '🇮🇳 Read in Hindi' : '🇺🇸 Read in English';

      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📥 Download PDF File (${result.title})`, url: result.pdfLink }],
            [{ text: alternateLabel, callback_data: `switch_${alternateLang}_${encodeURIComponent(searchQuery)}` }]
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
      const politeMessage = `❌ Maaf kijiye, yeh keyword nahi mila. Kripya spelling check karke doosra naam try karein.`;
      bot.sendMessage(chatId, politeMessage).catch(() => {});
    }
  }
});

console.log('Global Smart-Switch Bot successfully started...');
