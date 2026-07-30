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

// Wikipedia se Clean Summary aur Direct PDF/Print Link nikalne ka Function
async function getWikipediaPDFLink(query) {
  try {
    // Pehle search API se exact page title nikalenge
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`;
    const searchRes = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'ResearchBot/1.0' }
    });
    
    const searchResults = searchRes.data.query.search;
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const title = searchResults[0].title;
    
    // Ab us page ki summary (extract) nikalenge
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await axios.get(summaryUrl, {
      headers: { 'User-Agent': 'ResearchBot/1.0' }
    });

    const extract = summaryRes.data.extract || "Summary uplabdh nahi hai.";
    
    // Wikipedia ka official PDF/Print export link (Jisse user seedha PDF download kar sake)
    const pdfUrl = `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`;

    return {
      title: title,
      summary: extract,
      pdfLink: pdfUrl
    };
  } catch (error) {
    console.error('API Error:', error);
    return null;
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (msg.chat.type === 'private') {
    if (messageText === '/start') {
      bot.sendMessage(chatId, 'PDF Search Bot Ready! Topic ka naam bhejein.');
    } else {
      const processingMsg = await bot.sendMessage(chatId, '⏳ Tajjassus mein hoon, dhundh raha hoon...');
      
      const result = await getWikipediaPDFLink(messageText);
      
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

      if (result) {
        let replyText = `📄 **${result.title}**\n\n`;
        replyText += `${result.summary}\n\n`;
        replyText += `📥 [Download PDF File](${result.pdfLink})`;

        bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, '❌ Is keyword par kuch nahi mila.');
      }
    }
  }
});

console.log('PDF Bot successfully start ho gaya hai...');
