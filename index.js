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

// Search function for dokumen.pub
async function searchDocument(query) {
  try {
    const searchUrl = `https://dokumen.pub/search?q=${encodeURIComponent(query)}`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const $ = cheerio.load(data);
    
    let results = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && href.startsWith('https://dokumen.pub/') && text.length > 10 && results.length < 3) {
        if (!results.some(r => r.url === href)) {
          results.push({ title: text, url: href });
        }
      }
    });

    return results;
  } catch (error) {
    console.error('Scraping Error:', error);
    return [];
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  // Agar user private chat mein hai toh hi process karega
  if (msg.chat.type === 'private') {
    if (messageText === '/start') {
      bot.sendMessage(chatId, 'Namaste! Aapko jo bhi document ya book chahiye, uska naam yahan type karke bhejein.');
    } else {
      bot.sendMessage(chatId, '🔍 Search kiya ja raha hai, kripya intezaar karein...');
      
      const results = await searchDocument(messageText);
      
      if (results.length > 0) {
        let replyText = 'Aapke liye yeh documents mile hain:\n\n';
        results.forEach((item, index) => {
          replyText += `${index + 1}. ${item.title}\n🔗 ${item.url}\n\n`;
        });
        bot.sendMessage(chatId, replyText);
      } else {
        bot.sendMessage(chatId, 'Maaf kijiye, is keyword par koi document nahi mila. Kripya koi doosra naam try karein.');
      }
    }
  }
});

console.log('Bot successfully start ho gaya hai aur messages sun raha hai...');
