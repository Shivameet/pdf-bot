const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  console.log(`Message aaya: ${messageText}`);

  if (messageText === '/start') {
    bot.sendMessage(chatId, 'Namaste bhai! Mera naam PDF Research Helper Bot hai. Bataiye main aapki kya madad kar sakta hoon?');
  } else {
    bot.sendMessage(chatId, `Aapne likha: "${messageText}". Main ise jald hi samajhunga!`);
  }
});

console.log('Bot successfully start ho gaya hai aur messages sun raha hai...');
