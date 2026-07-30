const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Menu button commands set karna
bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'language', description: 'Change language' }
]);

// Crash-proof guards
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

const userLanguages = {};

// Render HTTP Server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running safely!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// Auto Language Detection
function detectLanguage(text) {
  const hindiRegex = /[\u0900-\u097F]/;
  if (hindiRegex.test(text)) return 'hi';
  return null;
}

// Wikipedia Data Fetching (Thumbnail, Short Summary & Circular PDF Link)
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
    
    // Summary ko chota (point-to-point) rakhne ke liye sirf pehle 2 sentences
    const sentences = extract.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 2) {
      extract = sentences.slice(0, 2).join(' ');
    }

    const pdfUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    return {
      title: title,
      summary: extract,
      image: imageUrl,
      pdfLink: pdfUrl
    };
  } catch (error) {
    console.error('API Error:', error.message);
    return null;
  }
}

// Flags ke sath Language Selection Menu (Sirf ek button jisko click karke list khule)
function getLanguageMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇺🇸 English', callback_data: 'lang_en' },
          { text: '🇮🇳 हिन्दी (Hindi)', callback_data: 'lang_hi' }
        ],
        [
          { text: '🇪🇸 Español', callback_data: 'lang_es' },
          { text: '🇫🇷 Français', callback_data: 'lang_fr' }
        ]
      ]
    }
  };
}

// Start Command (Clean Welcome Message without direct boxes)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `👋 **Welcome!**\n\n` +
    `🤖 *What does this bot do?*\n` +
    `You can get a short, clean summary and direct PDF of any topic.\n\n` +
    `Click below to change your language if needed:`;

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌐 Select Language / Bhasha Chunein', callback_data: 'show_lang_menu' }]
      ]
    }
  };

  bot.sendMessage(chatId, welcomeText, opts).catch(err => console.log('Start error:', err));
});

bot.onText(/\/language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🌐 Select your preferred language / Apni bhasha chunein:', getLanguageMenu())
    .catch(err => console.log('Language menu error:', err));
});

// Language change handler via buttons
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data === 'show_lang_menu') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, '🌐 Select your preferred language / Apni bhasha chunein:', getLanguageMenu());
    } else if (data.startsWith('lang_')) {
      const langCode = data.split('_')[1];
      userLanguages[chatId] = langCode;

      let langName = 'English';
      if (langCode === 'hi') langName = 'हिन्दी (Hindi)';
      else if (langCode === 'es') langName = 'Español';
      else if (langCode === 'fr') langName = 'Français';

      await bot.answerCallbackQuery(query.id, { text: `Language changed to ${langName}` });
      await bot.sendMessage(chatId, `✅ Language updated to *${langName}*.\n\nNow send any topic name!`, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.log('Callback error:', err);
  }
});

// Message handler for searching topics
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.voice) {
    bot.sendMessage(chatId, '🎙️ Voice note received! (Processing text search).').catch(() => {});
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return;
  const searchQuery = msg.text;

  if (msg.chat.type === 'private') {
    const autoLang = detectLanguage(searchQuery);
    const userLang = autoLang || userLanguages[chatId] || 'en';

    let processingMsg;
    try {
      processingMsg = await bot.sendMessage(chatId, '⏳ Searching...');
    } catch (e) {
      return;
    }
    
    const result = await getWikipediaData(searchQuery, userLang);
    
    if (processingMsg) {
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
    }

    if (result) {
      // Original Circular PDF Download Button format
      let caption = `📄 **${result.title}**\n\n`;
      caption += `${result.summary}\n\n`;
      caption += `📥 [${result.title}.pdf](${result.pdfLink})`;

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
          parse_mode: 'Markdown',
          reply_markup: opts.reply_markup
        }).catch(async () => {
          await bot.sendMessage(chatId, caption, opts).catch(() => {});
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

console.log('100% Perfect Fixed Bot successfully started...');
      
