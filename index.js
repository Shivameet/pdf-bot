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

// Advanced Wikipedia Search Function (100% Reliable & Stable)
async function searchWikipediaQuery(query) {
  try {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json`;
    
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ResearchBot/1.0'
      }
    });
    
    const searchResults = response.data.query.search;
    let results = [];

    if (searchResults && searchResults.length > 0) {
      searchResults.forEach(item => {
        const title = item.title;
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        results.push({
          title: title,
          url: url
        });
      });
    }

    return results;
  } catch (error) {
    console.error('Wikipedia Query API Error:', error);
    return [];
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type === 'private') {
    if (messageText === '/start') {
      bot.sendMessage(chatId, 'Research Helper Bot Ready! Kuch bhi type karke bhejein.');
    } else {
      const processingMsg = await bot.sendMessage(chatId, '🔍 Search ho raha hai...');
      
      const results = await searchWikipediaQuery(messageText);
      
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

console.log('Research Helper Bot successfully start ho gaya hai...');
