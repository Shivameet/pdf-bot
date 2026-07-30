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

// Free Translation Helper using public endpoint to convert any language/script to English
async function translateToEnglish(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { timeout: 5000 });
    if (res.data && res.data[0] && res.data[0][0] && res.data[0][0][0]) {
      const translated = res.data[0].map(item => item[0]).join('');
      if (translated && translated.trim() !== '') {
        return translated.trim();
      }
    }
  } catch (error) {
    console.log('Translation fallback error, using original query...');
  }
  return text;
}

// Robust Wikipedia Fetcher with Multi-Language and Auto-Translation Fallback
async function getWikipediaData(query) {
  // First, try direct query on English and Hindi
  let langsToTry = ['en', 'hi'];

  for (let lang of langsToTry) {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`;
      const searchRes = await axios.get(searchUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });
      
      const searchResults = searchRes.data?.query?.search;
      if (!searchResults || searchResults.length === 0) continue;

      const title = searchResults[0].title;
      
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryRes = await axios.get(summaryUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });

      const pageData = summaryRes.data;
      let extract = pageData.extract || "Summary not available.";
      const imageUrl = pageData.thumbnail ? pageData.thumbnail.source : null;
      
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
      console.log(`Failed for lang ${lang}, trying next fallback...`);
    }
  }

  // If direct search fails, translate query to English and retry English Wikipedia
  try {
    const translatedQuery = await translateToEnglish(query);
    if (translatedQuery && translatedQuery.toLowerCase() !== query.toLowerCase()) {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(translatedQuery)}&srlimit=1&format=json`;
      const searchRes = await axios.get(searchUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });
      
      const searchResults = searchRes.data?.query?.search;
      if (searchResults && searchResults.length > 0) {
        const title = searchResults[0].title;
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const summaryRes = await axios.get(summaryUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });

        const pageData = summaryRes.data;
        let extract = pageData.extract || "Summary not available.";
        const imageUrl = pageData.thumbnail ? pageData.thumbnail.source : null;
        
        const sentences = extract.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length > 2) {
          extract = sentences.slice(0, 2).join(' ');
        }

        const pdfUrl = `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

        return {
          title: title,
          summary: extract,
          image: imageUrl,
          pdfLink: pdfUrl,
          currentLang: 'en'
        };
      }
    }
  } catch (err) {
    console.log('Translated search fallback failed:', err);
  }

  return null;
}

// Start Command Handler
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `👋 *Welcome!*\n\n` +
    `🤖 *What does this bot do?*\n` +
    `Send any topic name in any script or language to get a short summary and a prominent direct PDF download.\n` +
    `Bot features smart global search fallback and instant language switching!`;

  bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' }).catch(err => console.log('Start error:', err));
});

bot.onText(/\/language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🌐 Current mode: Global Smart Search active.\nYou can type in any script or language, and the bot will automatically fetch the best available result with an instant translation toggle.`).catch(() => {});
});

// Callback Query Handler for instant English / Hindi toggle and English Search Fallback
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data.startsWith('switch_')) {
      const parts = data.split('_');
      const targetLang = parts[1];
      const encodedQuery = parts.slice(2).join('_');
      const searchQuery = decodeURIComponent(encodedQuery);

      await bot.answerCallbackQuery(query.id, { text: `Loading result...` });

      let processingMsg = await bot.sendMessage(chatId, '⏳ Loading alternative version...').catch(() => {});
      
      const searchLangUrl = `https://${targetLang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=1&format=json`;
      const searchRes = await axios.get(searchLangUrl, { headers: { 'User-Agent': 'ResearchBot/1.0' }, timeout: 8000 });
      const searchResults = searchRes.data?.query?.search;
      
      let targetTitle = searchQuery;
      if (searchResults && searchResults.length > 0) {
        targetTitle = searchResults[0].title;
      }

      const result = await getWikipediaData(targetTitle);
      
      if (processingMsg) {
        bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      }

      if (result) {
        let caption = `📄 *${result.title}* (${result.currentLang.toUpperCase()})\n\n${result.summary}`;
        if (caption.length > 1024) caption = caption.substring(0, 1020) + '...';

        const alternateLang = result.currentLang === 'en' ? 'hi' : 'en';
        const alternateLabel = result.currentLang === 'en' ? '🇮🇳 Read in Hindi' : '🇺🇸 Read in English';

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
        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `🔍 Search in English`, callback_data: `switch_en_${encodeURIComponent(searchQuery)}` }]
            ]
          }
        };
        bot.sendMessage(chatId, `❌ Sorry, alternative version not found. You can search in English using the button below:`, opts).catch(() => {});
      }
    }
  } catch (err) {
    console.log('Callback error:', err);
  }
});

// Message Handler with Free Translation Integration and Bulletproof Fallback
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

        const alternateLang = result.currentLang === 'en' ? 'hi' : 'en';
        const alternateLabel = result.currentLang === 'en' ? '🇮🇳 Read in Hindi' : '🇺🇸 Read in English';

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
        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `🔍 Search in English`, callback_data: `switch_en_${encodeURIComponent(searchQuery)}` }]
            ]
          }
        };
        const politeMessage = `❌ Sorry, direct keyword match not found. You can search in English using the button below:`;
        await bot.sendMessage(chatId, politeMessage, opts);
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
      bot.sendMessage(chatId, `❌ Technical issue occurred. You can search directly in English:`, opts).catch(() => {});
    }
  }
});

console.log('Global Fallback Smart Bot successfully started...');
    
