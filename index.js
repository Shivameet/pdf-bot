const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const cheerio = require('cheerio');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Render ke liye HTTP Server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// Wikipedia Search Function
async function searchWikipedia(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const $ = cheerio.load(data);
    
    let results = [];
    
    // Wikipedia ki search result list se titles aur links nikalna
    $('.mw-search-result-heading a').each((i, el) => {
      if (results.length < 3) {
        const title = $(el).attr('title');
        const href = 'https://en.wikipedia.org' + $(el).attr('href');
        if (title && href) {
          results.push({ title: title, url: href });
        }
      }
    });

    return results;
  } catch (error) {
    console.error('Wikipedia Scraping Error:', error);
    return [];
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type === 'private') {
    if (messageText === '/start') {
      bot.sendMessage(chatId, 'Wikipedia Bot Ready! Kuch bhi type karke bhejein.');
    } else {
      const processingMsg = await bot.sendMessage(chatId, '🔍 Wikipedia par search ho raha hai...');
      
      const results = await searchWikipedia(messageText);
      
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

      if (results.length > 0) {
        let replyText = `📚 **Wikipedia Results for:** ${messageText}\n\n`;
        results.forEach((item, index) => {
          replyText += `${index + 1}. ${item.title}\n🔗 ${item.url}\n\n`;
        });
        bot.sendMessage(chatId, replyText);
      } else {
        bot.sendMessage(chatId, '❌ Wikipedia par is keyword par kuch nahi mila.');
      }
    }
  }
});

console.log('Wikipedia Test Bot start ho gaya hai...');
