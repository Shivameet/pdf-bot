const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');

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

// Wikipedia Official API Search Function
async function searchWikipediaAPI(query) {
  try {
    // Wikipedia Opensearch API (Fast & Reliable)
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json`;
    
    const response = await axios.get(apiUrl);
    const data = response.data;
    
    // Wikipedia API response format: [query, [titles], [descriptions], [urls]]
    const titles = data[1];
    const urls = data[3];

    let results = [];
    for (let i = 0; i < titles.length; i++) {
      results.push({
        title: titles[i],
        url: urls[i]
      });
    }

    return results;
  } catch (error) {
    console.error('Wikipedia API Error:', error);
    return [];
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type === 'private') {
    if (messageText === '/start') {
      bot.sendMessage(chatId, 'Wikipedia API Bot Ready! Kuch bhi type karke bhejein.');
    } else {
      const processingMsg = await bot.sendMessage(chatId, '🔍 Search ho raha hai...');
      
      const results = await searchWikipediaAPI(messageText);
      
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

      if (results.length > 0) {
        let replyText = `📚 **Results for:** ${messageText}\n\n`;
        results.forEach((item, index) => {
          replyText += `${index + 1}. ${item.title}\n🔗 ${item.url}\n\n`;
        });
        bot.sendMessage(chatId, replyText);
      } else {
        bot.sendMessage(chatId, '❌ Is keyword par kuch nahi mila. Doosra naam try karein.');
      }
    }
  }
});

console.log('Wikipedia API Bot successfully start ho gaya hai...');
