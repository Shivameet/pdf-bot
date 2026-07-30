const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Render ke liye HTTP Server banana zaroori hai taaki port open rahe
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (messageText === '/start') {
    bot.sendMessage(chatId, 'Namaste bhai! Mera naam PDF Research Helper Bot hai. Bataiye main aapki kya madad kar sakta hoon?');
  } else {
    bot.sendMessage(chatId, `Aapne likha: "${messageText}". Main ise jald hi samajhunga!`);
  }
});

console.log('Bot successfully start ho gaya hai aur messages sun raha hai...');
