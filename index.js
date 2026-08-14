const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const axios = require('axios');
const NodeCache = require('node-cache');
const crypto = require('crypto');

// Contact email included by the bot owner for source administrators.
const CONTACT_EMAIL = 'contact.docseeker@gmail.com';
const BOT_NAME = 'ResearchHelperBot';
const BOT_VERSION = '5.0';
const USER_AGENT = `${BOT_NAME}/${BOT_VERSION} (contact: ${CONTACT_EMAIL})`;

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('CRITICAL: BOT_TOKEN is missing in environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Query buttons expire after 60 minutes. No website is contacted when these are created.
const querySessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
const wikipediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const arxivCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const pmcCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const wikipediaPdfCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
const pmcPaperCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
const inFlightCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

const MAX_PDF_BYTES = 48 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getXmlTagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1] : '';
}

function makeFileName(title) {
  const cleanedTitle = String(title)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 100);

  return `${cleanedTitle || 'research_document'}.pdf`;
}

function shortLabel(value, maxLength = 42) {
  const cleanValue = String(value).replace(/\s+/g, ' ').trim();
  return cleanValue.length > maxLength ? `${cleanValue.slice(0, maxLength - 1)}…` : cleanValue;
}

function normalizeQuery(query) {
  return String(query).trim().toLowerCase().replace(/\s+/g, ' ');
}

function getRequestConfig(extra = {}) {
  return {
    headers: {
      'User-Agent': USER_AGENT,
      ...(extra.headers || {})
    },
    timeout: 30000,
    ...extra
  };
}

function getRetryAfterMs(error, fallbackMs) {
  const retryAfter = error?.response?.headers?.['retry-after'];
  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 10 * 60 * 1000);
  }

  return fallbackMs;
}

function isRetryableError(error) {
  const status = error?.response?.status;
  return status === 429 || status === 503;
}

class SourceQueue {
  constructor(name, minimumIntervalMs) {
    this.name = name;
    this.minimumIntervalMs = minimumIntervalMs;
    this.pending = [];
    this.running = false;
    this.nextAllowedAt = 0;
  }

  setCooldown(milliseconds) {
    this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + milliseconds);
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.processNext();
    });
  }

  async processNext() {
    if (this.running || this.pending.length === 0) {
      return;
    }

    this.running = true;
    const item = this.pending.shift();
    const waitMs = Math.max(0, this.nextAllowedAt - Date.now());

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      const result = await item.task();
      this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + this.minimumIntervalMs);
      item.resolve(result);
    } catch (error) {
      this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + this.minimumIntervalMs);
      item.reject(error);
    } finally {
      this.running = false;
      setImmediate(() => this.processNext());
    }
  }
}

// Conservative internal caps, deliberately below the sources' published limits.
// Wikipedia: 1 request/sec (60/min; 30% of its 200/min compliant-UA ceiling).
// arXiv: 1 request/4 sec (15/min; lower than its 1 request/3 sec rule).
// PMC: 1 request/2 sec (30/min; far below its 3 requests/sec ceiling).
// OAPEN / Internet Archive: no automatic API crawling in this version.
const wikipediaQueue = new SourceQueue('Wikipedia', 1000);
const arxivQueue = new SourceQueue('arXiv', 4000);
const pmcQueue = new SourceQueue('PMC', 2000);

async function limitedGet(queue, url, config = {}) {
  return queue.enqueue(async () => {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await axios.get(url, getRequestConfig(config));
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || attempt === 2) {
          throw error;
        }

        const fallbackDelay = 5000 * (2 ** attempt);
        const delayMs = getRetryAfterMs(error, fallbackDelay);
        queue.setCooldown(delayMs);
        await sleep(delayMs);
      }
    }

    throw lastError;
  });
}

async function runShared(key, work) {
  const active = inFlightCache.get(key);
  if (active) {
    return active;
  }

  const promise = work().finally(() => inFlightCache.del(key));
  inFlightCache.set(key, promise);
  return promise;
}

function createQuerySession(topic) {
  const token = crypto.randomBytes(12).toString('hex');
  querySessionCache.set(token, { topic: topic.trim() });
  return token;
}

function createGoogleSiteSearchUrl(domain, topic) {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${topic}`)}`;
}

function createInternetArchiveSearchUrl(topic) {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:archive.org/details ${topic}`)}`;
}

function createSourceButtons(topic, token) {
  return {
    inline_keyboard: [
      [
        { text: '📘 Wikipedia', callback_data: `src:wiki:${token}` },
        { text: '🔬 arXiv Research', callback_data: `src:arxiv:${token}` }
      ],
      [
        { text: '🩺 PMC Open Access', callback_data: `src:pmc:${token}` },
        { text: '📚 OAPEN Books', url: createGoogleSiteSearchUrl('library.oapen.org', topic) }
      ],
      [
        { text: '🎓 OpenStax Textbooks', url: createGoogleSiteSearchUrl('openstax.org', topic) },
        { text: '📖 Gutenberg Classics', url: createGoogleSiteSearchUrl('gutenberg.org', topic) }
      ],
      [
        { text: '🏛️ Internet Archive', url: createInternetArchiveSearchUrl(topic) },
        { text: '🔍 Dokumen.pub Search', url: createGoogleSiteSearchUrl('dokumen.pub', topic) }
      ]
    ]
  };
}

async function getWikipediaContent(query) {
  const normalized = normalizeQuery(query);
  const cacheKey = `wiki:${normalized}`;
  const cached = wikipediaCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  return runShared(cacheKey, async () => {
    const cachedAfterWait = wikipediaCache.get(cacheKey);
    if (cachedAfterWait) {
      return cachedAfterWait;
    }

    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', normalized);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('format', 'json');

    const searchResponse = await limitedGet(wikipediaQueue, searchUrl.toString());
    const searchResults = searchResponse.data?.query?.search;

    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const title = searchResults[0].title;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryResponse = await limitedGet(wikipediaQueue, summaryUrl);
    const pageData = summaryResponse.data;

    if (pageData.type === 'disambiguation') {
      return null;
    }

    const result = {
      title,
      summary: pageData.extract || 'Summary not available.',
      pdfUrl: `https://en.wikipedia.org/api/rest_v1/page/pdf/${encodeURIComponent(title)}`
    };

    wikipediaCache.set(cacheKey, result);
    return result;
  });
}

async function getArxivResults(query) {
  const normalized = normalizeQuery(query);
  const cacheKey = `arxiv:${normalized}`;
  const cached = arxivCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  return runShared(cacheKey, async () => {
    const cachedAfterWait = arxivCache.get(cacheKey);
    if (cachedAfterWait) {
      return cachedAfterWait;
    }

    const searchUrl = new URL('https://export.arxiv.org/api/query');
    searchUrl.searchParams.set('search_query', `all:${normalized}`);
    searchUrl.searchParams.set('start', '0');
    searchUrl.searchParams.set('max_results', '3');
    searchUrl.searchParams.set('sortBy', 'relevance');
    searchUrl.searchParams.set('sortOrder', 'descending');

    const response = await limitedGet(arxivQueue, searchUrl.toString(), { responseType: 'text' });
    const xml = String(response.data);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const results = [];

    for (const entry of entries) {
      const title = decodeXml(getXmlTagValue(entry, 'title')).replace(/\s+/g, ' ').trim();
      const abstractUrl = decodeXml(getXmlTagValue(entry, 'id')).trim();
      const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
        .map((match) => decodeXml(match[1]).trim())
        .filter(Boolean);

      if (!title || !abstractUrl) {
        continue;
      }

      const arxivId = abstractUrl.split('/abs/')[1];
      results.push({
        title,
        authors,
        abstractUrl,
        pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : abstractUrl
      });
    }

    arxivCache.set(cacheKey, results);
    return results;
  });
}

async function getPmcResults(query) {
  const normalized = normalizeQuery(query);
  const cacheKey = `pmc:${normalized}`;
  const cached = pmcCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  return runShared(cacheKey, async () => {
    const cachedAfterWait = pmcCache.get(cacheKey);
    if (cachedAfterWait) {
      return cachedAfterWait;
    }

    const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
    searchUrl.searchParams.set('db', 'pmc');
    searchUrl.searchParams.set('term', normalized);
    searchUrl.searchParams.set('retmax', '3');
    searchUrl.searchParams.set('retmode', 'json');
    searchUrl.searchParams.set('tool', BOT_NAME);
    searchUrl.searchParams.set('email', CONTACT_EMAIL);

    const searchResponse = await limitedGet(pmcQueue, searchUrl.toString());
    const ids = searchResponse.data?.esearchresult?.idlist || [];

    if (ids.length === 0) {
      return [];
    }

    const summaryUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    summaryUrl.searchParams.set('db', 'pmc');
    summaryUrl.searchParams.set('id', ids.join(','));
    summaryUrl.searchParams.set('retmode', 'json');
    summaryUrl.searchParams.set('tool', BOT_NAME);
    summaryUrl.searchParams.set('email', CONTACT_EMAIL);

    const summaryResponse = await limitedGet(pmcQueue, summaryUrl.toString());
    const summaryData = summaryResponse.data?.result || {};
    const results = ids.map((id) => {
      const item = summaryData[id] || {};
      return {
        pmcId: `PMC${id}`,
        title: item.title || `PMC Article ${id}`,
        source: item.source || '',
        articleUrl: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${id}/`
      };
    });

    pmcCache.set(cacheKey, results);
    return results;
  });
}

async function getPmcOpenAccessPdfUrl(pmcId) {
  const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=${encodeURIComponent(pmcId)}`;
  const response = await limitedGet(pmcQueue, url, { responseType: 'text' });
  const xml = String(response.data);
  const linkTags = xml.match(/<link\b[^>]*\/>/g) || [];
  const pdfTag = linkTags.find((tag) => /format=["']pdf["']/i.test(tag));

  if (!pdfTag) {
    return null;
  }

  const hrefMatch = pdfTag.match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) {
    return null;
  }

  return decodeXml(hrefMatch[1]).replace(/^ftp:/i, 'https:');
}

async function downloadPdf(queue, pdfUrl) {
  const response = await limitedGet(queue, pdfUrl, {
    responseType: 'arraybuffer',
    maxContentLength: MAX_PDF_BYTES,
    maxBodyLength: MAX_PDF_BYTES
  });

  const fileBuffer = Buffer.from(response.data);
  const contentType = String(response.headers['content-type'] || '').toLowerCase();

  if (!fileBuffer.length || fileBuffer.length > MAX_PDF_BYTES) {
    throw new Error('PDF file is unavailable or too large.');
  }

  if (contentType && !contentType.includes('application/pdf')) {
    throw new Error('Source did not return a PDF file.');
  }

  return fileBuffer;
}

async function sendWikipediaResult(chatId, topic) {
  const result = await getWikipediaContent(topic);

  if (!result) {
    await bot.sendMessage(chatId, '<b>No Wikipedia result found.</b>\n\nPlease search with English keywords.', { parse_mode: 'HTML' });
    return;
  }

  const pdfToken = crypto.randomBytes(12).toString('hex');
  wikipediaPdfCache.set(pdfToken, result);

  let summaryText = [
    `<b>${escapeHtml(result.title)}</b>`,
    '',
    escapeHtml(result.summary)
  ].join('\n');

  if (summaryText.length > 4096) {
    summaryText = `${summaryText.slice(0, 4080)}...`;
  }

  await bot.sendMessage(chatId, summaryText, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: '📥 Send Wikipedia PDF', callback_data: `wikipdf:${pdfToken}` }
      ]]
    }
  });
}

async function sendArxivResults(chatId, topic) {
  const results = await getArxivResults(topic);

  if (!results.length) {
    await bot.sendMessage(chatId, '<b>No arXiv research result found.</b>\n\nPlease search with English keywords.', { parse_mode: 'HTML' });
    return;
  }

  const message = [
    '<b>arXiv Research Results</b>',
    '',
    ...results.map((item, index) => `${index + 1}. <b>${escapeHtml(item.title)}</b>${item.authors.length ? `\n${escapeHtml(item.authors.slice(0, 3).join(', '))}` : ''}`)
  ].join('\n\n');

  const buttons = results.map((item, index) => ([
    { text: `📄 ${index + 1}. Official arXiv PDF`, url: item.pdfUrl },
    { text: '📝 Paper Summary (पहले पढ़ें)', url: item.abstractUrl }
  ]));

  await bot.sendMessage(chatId, message.slice(0, 4096), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons }
  });
}

async function sendPmcResults(chatId, topic) {
  const results = await getPmcResults(topic);

  if (!results.length) {
    await bot.sendMessage(chatId, '<b>No PMC result found.</b>\n\nPlease search with English keywords.', { parse_mode: 'HTML' });
    return;
  }

  const message = [
    '<b>PMC Medical Research Results</b>',
    '',
    ...results.map((item, index) => `${index + 1}. <b>${escapeHtml(item.title)}</b>${item.source ? `\n${escapeHtml(item.source)}` : ''}`)
  ].join('\n\n');

  const buttons = results.map((item, index) => {
    const paperToken = crypto.randomBytes(12).toString('hex');
    pmcPaperCache.set(paperToken, item);

    return [
      { text: `🩺 ${index + 1}. Check official OA PDF`, callback_data: `pmcpdf:${paperToken}` },
      { text: 'Article', url: item.articleUrl }
    ];
  });

  await bot.sendMessage(chatId, message.slice(0, 4096), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons }
  });
}

async function handleSourceSelection(callbackQuery, sourceName, sessionToken) {
  const session = querySessionCache.get(sessionToken);
  const chatId = callbackQuery.message?.chat?.id;

  if (!chatId || !session) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: 'This source button has expired. Please send the topic again.',
      show_alert: true
    }).catch(() => {});
    return;
  }

  await bot.answerCallbackQuery(callbackQuery.id, {
    text: `Searching ${sourceName} safely...`
  }).catch(() => {});

  let statusMessageId = null;

  try {
    const statusMessage = await bot.sendMessage(chatId, `Searching ${sourceName}. Please wait...`);
    statusMessageId = statusMessage.message_id;

    if (sourceName === 'Wikipedia') {
      await sendWikipediaResult(chatId, session.topic);
    } else if (sourceName === 'arXiv') {
      await sendArxivResults(chatId, session.topic);
    } else if (sourceName === 'PMC') {
      await sendPmcResults(chatId, session.topic);
    }

    if (statusMessageId) {
      await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
    }
  } catch (error) {
    console.error(`${sourceName} source error:`, error.message);

    if (statusMessageId) {
      await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
    }

    const status = error?.response?.status;
    const errorText = status === 429 || status === 503
      ? `<b>${escapeHtml(sourceName)} is busy.</b>\n\nThe bot has paused requests to protect access. Please try again shortly.`
      : `<b>${escapeHtml(sourceName)} search failed.</b>\n\nPlease try again in a moment.`;

    await bot.sendMessage(chatId, errorText, { parse_mode: 'HTML' }).catch(() => {});
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text?.trim();

  if (msg.chat.type !== 'private' || !messageText) {
    return;
  }

  if (messageText === '/start') {
    const welcomeMessage = [
      '<b>Research Helper Bot</b>',
      '',
      'Send an English topic, book name, person name, or research subject.',
      '',
      'The bot will first show source buttons only. It will contact a source only after you choose that source button.',
      '',
      'This protects source limits and reduces unnecessary requests. Use /help to understand every button.'
    ].join('\n');

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText === '/help') {
    const helpMessage = [
      '<b>How the source buttons work</b>',
      '',
      '<b>Wikipedia</b>: Search summary, then optionally receive a Telegram PDF.',
      '<b>arXiv Research</b>: Search official research papers, then open official paper PDFs.',
      '<b>PMC Open Access</b>: Search medical research, then verify and send an official OA PDF when available.',
      '<b>OAPEN, OpenStax, Gutenberg, Internet Archive</b>: Open the chosen source in your browser without any bot-side data request.',
      '<b>Dokumen.pub Search</b>: Open Google results limited to Dokumen.pub; the bot does not download files from it.'
    ].join('\n\n');

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
    return;
  }

  if (messageText.startsWith('/')) {
    return;
  }

  const sessionToken = createQuerySession(messageText);
  const selectionMessage = [
    `<b>Select a source for: ${escapeHtml(messageText)}</b>`,
    '',
    'No source is contacted until you press a button.'
  ].join('\n');

  await bot.sendMessage(chatId, selectionMessage, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: createSourceButtons(messageText, sessionToken)
  });
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data || '';
  const chatId = callbackQuery.message?.chat?.id;

  if (!chatId) {
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    return;
  }

  if (data.startsWith('src:wiki:')) {
    await handleSourceSelection(callbackQuery, 'Wikipedia', data.slice('src:wiki:'.length));
    return;
  }

  if (data.startsWith('src:arxiv:')) {
    await handleSourceSelection(callbackQuery, 'arXiv', data.slice('src:arxiv:'.length));
    return;
  }

  if (data.startsWith('src:pmc:')) {
    await handleSourceSelection(callbackQuery, 'PMC', data.slice('src:pmc:'.length));
    return;
  }

  if (data.startsWith('wikipdf:')) {
    const pdfToken = data.slice('wikipdf:'.length);
    const result = wikipediaPdfCache.get(pdfToken);

    if (!result) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'This PDF button has expired. Please search again.',
        show_alert: true
      }).catch(() => {});
      return;
    }

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Preparing Wikipedia PDF...' }).catch(() => {});

    let statusMessageId = null;
    try {
      const statusMessage = await bot.sendMessage(chatId, 'Preparing the Wikipedia PDF document...');
      statusMessageId = statusMessage.message_id;
      const pdfBuffer = await downloadPdf(wikipediaQueue, result.pdfUrl);

      await bot.sendDocument(chatId, pdfBuffer, {
        caption: `<b>${escapeHtml(result.title)}</b>\nWikipedia PDF document`,
        parse_mode: 'HTML'
      }, {
        filename: makeFileName(result.title),
        contentType: 'application/pdf'
      });
    } catch (error) {
      console.error('Wikipedia PDF error:', error.message);
      await bot.sendMessage(chatId, '<b>Wikipedia PDF could not be sent.</b>\n\nPlease try again later.', { parse_mode: 'HTML' }).catch(() => {});
    } finally {
      if (statusMessageId) {
        await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
      }
    }
    return;
  }

  if (data.startsWith('pmcpdf:')) {
    const paperToken = data.slice('pmcpdf:'.length);
    const paper = pmcPaperCache.get(paperToken);

    if (!paper) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'This article button has expired. Please search again.',
        show_alert: true
      }).catch(() => {});
      return;
    }

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Checking the official PMC OA PDF...' }).catch(() => {});

    let statusMessageId = null;
    try {
      const statusMessage = await bot.sendMessage(chatId, 'Checking official Open Access PDF availability...');
      statusMessageId = statusMessage.message_id;
      const pdfUrl = await getPmcOpenAccessPdfUrl(paper.pmcId);

      if (!pdfUrl) {
        await bot.sendMessage(chatId, [
          '<b>No reusable PMC Open Access PDF was found for this article.</b>',
          '',
          `<a href="${paper.articleUrl}">Open the official PMC article</a>`
        ].join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true });
        return;
      }

      const pdfBuffer = await downloadPdf(pmcQueue, pdfUrl);
      await bot.sendDocument(chatId, pdfBuffer, {
        caption: `<b>${escapeHtml(paper.title)}</b>\nPMC Open Access PDF document`,
        parse_mode: 'HTML'
      }, {
        filename: makeFileName(paper.title),
        contentType: 'application/pdf'
      });
    } catch (error) {
      console.error('PMC PDF error:', error.message);
      await bot.sendMessage(chatId, [
        '<b>PMC Open Access PDF could not be sent.</b>',
        '',
        `<a href="${paper.articleUrl}">Open the official PMC article</a>`
      ].join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
    } finally {
      if (statusMessageId) {
        await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
      }
    }
    return;
  }

  await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
});

console.log('On-demand Research Helper Bot started successfully.');
