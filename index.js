const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const app = express();
app.use(express.json());

const bot = new TelegramBot(token);
const PORT = process.env.PORT || 3000;
const RENDER_URL = 'https://dashboard.render.com/web/srv-d9lesi7lk1mc738l6emg';

bot.setWebHook(`${RENDER_URL}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('PDF Research Helper Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
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
