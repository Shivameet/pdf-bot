const TelegramBot = require('node-telegram-bot-api');[span_0](start_span)[span_0](end_span)
const http = require('http');[span_1](start_span)[span_1](end_span)
const axios = require('axios');[span_2](start_span)[span_2](end_span)
const NodeCache = require('node-cache');[span_3](start_span)[span_3](end_span)

// Store successful Wikipedia results for 24 hours in memory.
const wikipediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });[span_4](start_span)[span_4](end_span)

const TOKEN = process.env.BOT_TOKEN;[span_5](start_span)[span_5](end_span)
if (!TOKEN) {[span_6](start_span)[span_6](end_span)
  console.error('CRITICAL: BOT_TOKEN is missing in environment variables.');[span_7](start_span)[span_7](end_span)
  process.exit(1);[span_8](start_span)[span_8](end_span)
}[span_9](start_span)[span_9](end_span)

const bot = new TelegramBot(TOKEN, { polling: true });[span_10](start_span)[span_10](end_span)

process.on('uncaughtException', (error) => {[span_11](start_span)[span_11](end_span)
  console.error('Uncaught exception:', error);[span_12](start_span)[span_12](end_span)
});[span_13](start_span)[span_13](end_span)

process.on('unhandledRejection', (reason) => {[span_14](start_span)[span_14](end_span)
  console.error('Unhandled rejection:', reason);[span_15](start_span)[span_15](end_span)
});[span_16](start_span)[span_16](end_span)

bot.on('polling_error', (error) => {[span_17](start_span)[span_17](end_span)
  console.error('Telegram polling error:', error.message);[span_18](start_span)[span_18](end_span)
});[span_19](start_span)[span_19](end_span)

// Simple health-check endpoint for hosts such as Render.
const PORT = process.env.PORT || 3000;[span_20](start_span)[span_20](end_span)
const server = http.createServer((req, res) => {[span_21](start_span)[span_21](end_span)
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });[span_22](start_span)[span_22](end_span)
  res.end('Bot service is running.\n');[span_23](start_span)[span_23](end_span)
});[span_24](start_span)[span_24](end_span)

server.listen(PORT, () => {[span_25](start_span)[span_25](end_span)
  console.log(`Health-check server is listening on port ${PORT}`);[span_26](start_span)[span_26](end_span)
});[span_27](start_span)[span_27](end_span)

bot.setMyCommands([[span_28](start_span)[span_28](end_span)
  { command: 'start', description: 'Start the bot and view instructions' },[span_29](start_span)[span_29](end_span)
  { command: 'language', description: 'View the active search language' }[span_30](start_span)[span_30](end_span)
]).catch((error) => {[span_31](start_span)[span_31](end_span)
  console.error('Failed to register commands:', error.message);[span_32](start_span)[span_32](end_span)
});[span_33](start_span)[span_33](end_span)

function escapeHtml(value) {[span_34](start_span)[span_34](end_span)
  return String(value)[span_35](start_span)[span_35](end_span)
    .replace(/&/g, '&amp;')[span_36](start_span)[span_36](end_span)
    .replace(/</g, '&lt;')[span_37](start_span)[span_37](end_span)
    .replace(/>/g, '&gt;');[span_38](start_span)[span_38](end_span)
}[span_39](start_span)[span_39](end_span)

async function getWikipediaPDFContent(query) {[span_40](start_span)[span_40](end_span)
  const trimmedQuery = query.trim().toLowerCase();[span_41](start_span)[span_41](end_span)
  if (!trimmedQuery) {[span_42](start_span)[span_42](end_span)
    return null;[span_43](start_span)[span_43](end_span)
  }[span_44](start_span)[span_44](end_span)

  if (wikipediaCache.has(trimmedQuery)) {[span_45](start_span)[span_45](end_span)
    console.log(`Cache hit for query: "${trimmedQuery}"`);[span_46](start_span)[span_46](end_span)
    return wikipediaCache.get(trimmedQuery);[span_47](start_span)[span_47](end_span)
  }[span_48](start_span)[span_48](end_span)

  try {[span_49](start_span)[span_49](end_span)
    console.log(`Cache miss. Fetching Wikipedia data for: "${trimmedQuery}"`);[span_50](start_span)[span_50](end_span)

    const requestConfig = {[span_51](start_span)[span_51](end_span)
      headers: {[span_52](start_span)[span_52](end_span)
        // Replace the contact address with your own contact address before deployment.
        'User-Agent': 'TelegramResearchBot/2.0 (contact: your-email@example.com)[span_53](start_span)'[span_53](end_span)
      },[span_54](start_span)[span_54](end_span)
      timeout: 8000[span_55](start_span)[span_55](end_span)
    };[span_56](start_span)[span_56](end_span)

    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');[span_57](start_span)[span_57](end_span)
    searchUrl.searchParams.set('action', 'query');[span_58](start_span)[span_58](end_span)
    searchUrl.searchParams.set('list', 'search');[span_59](start_span)[span_59](end_span)
    searchUrl.searchParams.set('srsearch', trimmedQuery);[span_60](start_span)[span_60](end_span)
    searchUrl.searchParams.set('srlimit', '1');[span_61](start_span)[span_61](end_span)
    searchUrl.searchParams.set('format', 'json');[span_62](start_span)[span_62](end_span)

    const searchResponse = await axios.get(searchUrl.toString(), requestConfig);[span_63](start_span)[span_63](end_span)
    const searchResults = searchResponse.data?.query?.search;[span_64](start_span)[span_64](end_span)

    if (!searchResults || searchResults.length === 0) {[span_65](start_span)[span_65](end_span)
      return null;[span_66](start_span)[span_66](end_span)
    }[span_67](start_span)[span_67](end_span)

    const title = searchResults[0].title;[span_68](start_span)[span_68](end_span)
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;[span_69](start_span)[span_69](end_span)
    const summaryResponse = await axios.get(summaryUrl, requestConfig);[span_70](start_span)[span_70](end_span)
    const pageData = summaryResponse.data;[span_71](start_span)[span_71](end_span)

    if (pageData.type === 'disambiguation') {[span_72](start_span)[span_72](end_span)
      return null;[span_73](start_span)[span_73](end_span)
    }[span_74](start_span)[span_74](end_span)

    const resultPayload = {[span_75](start_span)[span_75](end_span)
      title,[span_76](start_span)[span_76](end_span)
      summary: pageData.extract || 'Summary not available.',[span_77](start_span)[span_77](end_span)
      pdfLink: `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`[span_78](start_span)[span_78](end_span)
    };[span_79](start_span)[span_79](end_span)

    wikipediaCache.set(trimmedQuery, resultPayload);[span_80](start_span)[span_80](end_span)
    return resultPayload;[span_81](start_span)[span_81](end_span)
  } catch (error) {[span_82](start_span)[span_82](end_span)
    console.error('Wikipedia API error:', error.message);[span_83](start_span)[span_83](end_span)
    return null;[span_84](start_span)[span_84](end_span)
  }[span_85](start_span)[span_85](end_span)
}[span_86](start_span)[span_86](end_span)

bot.on('message', async (msg) => {[span_87](start_span)[span_87](end_span)
  const chatId = msg.chat.id;[span_88](start_span)[span_88](end_span)
  const messageText = msg.text?.trim();[span_89](start_span)[span_89](end_span)

  // Keep the current private-chat-only behaviour.
  if (msg.chat.type !== 'private' || !messageText) {[span_90](start_span)[span_90](end_span)
    return;[span_91](start_span)[span_91](end_span)
  }[span_92](start_span)[span_92](end_span)

  if (messageText === '/start') {[span_93](start_span)[span_93](end_span)
    const welcomeMessage = [[span_94](start_span)[span_94](end_span)
      '<b>Welcome to Research PDF Bot</b>',[span_95](start_span)[span_95](end_span)
      '',[span_96](start_span)[span_96](end_span)
      'Send an English keyword or topic name to receive a Wikipedia summary and its PDF link.',[span_97](start_span)[span_97](end_span)
      '',[span_98](start_span)[span_98](end_span)
      'Use /language to view the active search language.[span_99](start_span)'[span_99](end_span)
    ].join('\n');[span_100](start_span)[span_100](end_span)

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });[span_101](start_span)[span_101](end_span)
    return;[span_102](start_span)[span_102](end_span)
  }[span_103](start_span)[span_103](end_span)

  if (messageText === '/language') {[span_104](start_span)[span_104](end_span)
    await bot.sendMessage(chatId, 'Current search language: English Wikipedia.', { parse_mode: 'HTML' });[span_105](start_span)[span_105](end_span)
    return;[span_106](start_span)[span_106](end_span)
  }[span_107](start_span)[span_107](end_span)

  if (messageText.startsWith('/')) {[span_108](start_span)[span_108](end_span)
    return;[span_109](start_span)[span_109](end_span)
  }[span_110](start_span)[span_110](end_span)

  let processingMessageId = null;[span_111](start_span)[span_111](end_span)

  try {[span_112](start_span)[span_112](end_span)
    const processingMessage = await bot.sendMessage(chatId, 'Searching Wikipedia...');[span_113](start_span)[span_113](end_span)
    processingMessageId = processingMessage.message_id;[span_114](start_span)[span_114](end_span)

    const result = await getWikipediaPDFContent(messageText);[span_115](start_span)[span_115](end_span)

    if (processingMessageId) {[span_116](start_span)[span_116](end_span)
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});[span_117](start_span)[span_117](end_span)
    }[span_118](start_span)[span_118](end_span)

    if (!result) {[span_119](start_span)[span_119](end_span)
      await bot.sendMessage([span_120](start_span)[span_120](end_span)
        chatId,[span_121](start_span)[span_121](end_span)
        '<b>No matching record found.</b>\n\nPlease check the spelling and try an English search term.',[span_122](start_span)[span_122](end_span)
        { parse_mode: 'HTML' }[span_123](start_span)[span_123](end_span)
      );[span_124](start_span)[span_124](end_span)
      return;[span_125](start_span)[span_125](end_span)
    }[span_126](start_span)[span_126](end_span)

    let replyText = [[span_127](start_span)[span_127](end_span)
      `<b>${escapeHtml(result.title)}</b>`,[span_128](start_span)[span_128](end_span)
      '',[span_129](start_span)[span_129](end_span)
      escapeHtml(result.summary),[span_130](start_span)[span_130](end_span)
      '',[span_131](start_span)[span_131](end_span)
      `<a href="${result.pdfLink}">Download PDF File</a>`[span_132](start_span)[span_132](end_span)
    ].join('\n');[span_133](start_span)[span_133](end_span)

    if (replyText.length > 4096) {[span_134](start_span)[span_134](end_span)
      replyText = `${replyText.slice(0, 4080)}...`;[span_135](start_span)[span_135](end_span)
    }[span_136](start_span)[span_136](end_span)

    await bot.sendMessage(chatId, replyText, {[span_137](start_span)[span_137](end_span)
      parse_mode: 'HTML',[span_138](start_span)[span_138](end_span)
      disable_web_page_preview: true[span_139](start_span)[span_139](end_span)
    });[span_140](start_span)[span_140](end_span)
  } catch (error) {[span_141](start_span)[span_141](end_span)
    console.error('Message dispatcher error:', error.message);[span_142](start_span)[span_142](end_span)

    if (processingMessageId) {[span_143](start_span)[span_143](end_span)
      await bot.deleteMessage(chatId, processingMessageId).catch(() => {});[span_144](start_span)[span_144](end_span)
    }[span_145](start_span)[span_145](end_span)

    await bot.sendMessage([span_146](start_span)[span_146](end_span)
      chatId,[span_147](start_span)[span_147](end_span)
      '<b>System error.</b>\n\nPlease try again in a moment.',[span_148](start_span)[span_148](end_span)
      { parse_mode: 'HTML' }[span_149](start_span)[span_149](end_span)
    ).catch(() => {});[span_150](start_span)[span_150](end_span)
  }[span_151](start_span)[span_151](end_span)
});[span_152](start_span)[span_152](end_span)

console.log('Telegram Wikipedia PDF Bot started successfully.');[span_153](start_span)[span_153](end_span)
