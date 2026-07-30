const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Crash-proof guards
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

const userLanguages = {};

// Render HTTP Server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
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

// Wikipedia Data Fetching (Short summary & Big PDF Button)
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
    
    // Summary ko chota (point-to-point) rakhne ke liye sirf pehle 2 ya 3 sentences lenge
    const sentences = extract.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 2) {
      extract = sentences.slice(0, 2).join(' ');
    }

    const pdfUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    return {
      title: title,
      summary: extract,
      pdfLink: pdfUrl
    };
  } catch (error) {
    console.error('API Error:', error.message);
    return null;
  }
}

// Flags ke sath Clean Language Menu
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

// Start Command with Introduction & Clean Language Menu
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `👋 **Welcome!**\n\n` +
    `🤖 *Yeh bot kya karta hai?*\n` +
    `Is bot ki madad se aap kisi bhi topic ki choti, saaf-suthri summary aur uska **direct PDF** ek click mein download kar sakte hain.\n\n` +
    `🌐 *Apni pasand ki bhasha chunein:*`;

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    ...getLanguageMenu()
  }).catch(err => console.log('Start error:', err));
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
    if (data.startsWith('lang_') && data !== 'lang_menu') {
      const langCode = data.split('_')[1];
      userLanguages[chatId] = langCode;

      let langName = 'English';
      if (langCode === 'hi') langName = 'हिन्दी (Hindi)';
      else if (langCode === 'es') langName = 'Español';
      else if (langCode === 'fr') langName = 'Français';

      await bot.answerCallbackQuery(query.id, { text: `Language changed to ${langName}` });
      await bot.sendMessage(chatId, `✅ Language updated to *${langName}*.\n\nAb aap koi bhi topic bhej sakte hain!`, { parse_mode: 'Markdown' });
    } else if (data === 'lang_menu') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, '🌐 Select your language:', getLanguageMenu());
    }
  } catch (err) {
    console.log('Callback error:', err);
  }
});

// Message handler for searching topics
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.voice) {
    bot.sendMessage(chatId, '🎙️ Voice note received! (Voice search feature is active, currently text search is processing).').catch(() => {});
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return;
  const searchQuery = msg.text;

  if (msg.chat.type === 'private') {
    const autoLang = detectLanguage(searchQuery);
    const userLang = autoLang || userLanguages[chatId]|| 'en';

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
      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 Download PDF File', url: result.pdfLink }],
            [{ text: '🌐 Change Language / Bhasha Badlein', callback_data: 'lang_menu' }]
          ]
        }
      };

      let replyText = `📄 **${result.title}**\n\n`;
      replyText += `${result.summary}`;

      bot.sendMessage(chatId, replyText, opts).catch(() => {});
    } else {
      // Friendly, polite fallback message when no data is found
      const politeMessage = `🔍 Maaf kijiye, "${searchQuery}" se judi koi jaankari ya file abhi nahi mil paayi.\n\nKripya ek baar spelling check karke koi doosra keyword try karein! ✨`;
      bot.sendMessage(chatId, politeMessage).catch(() => {});
    }
  }
});

console.log('Clean & Final Bot successfully started...');
