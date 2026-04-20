import Parser from 'rss-parser';
import axios from 'axios';
import logger from '../utils/logger.js';
import { rssCache } from '../utils/cache.js';

const parser = new Parser({ timeout: 10000 });

const RSS_FEEDS = [
  { name: 'pelando', url: 'https://www.pelando.com.br/rss' },
  { name: 'promobit', url: 'https://www.promobit.com.br/feed/offers' },
  { name: 'cuponomia', url: 'https://www.cuponomia.com.br/feed' },
];

const DEFAULT_TIMEOUT = 15000;
const MAX_RETRIES = 2;

function extractPrice(text) {
  const matches = text.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g);
  if (!matches || matches.length === 0) return { preco: 0, preco_de: 0 };

  const prices = matches.map((m) =>
    parseFloat(m.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.'))
  );

  const preco = prices[0];
  const preco_de = prices.length > 1 ? prices[1] : preco;

  return { preco, preco_de };
}

function calculateDiscount(preco, precoDe) {
  if (!precoDe || precoDe <= preco || precoDe <= 0) return 0;
  return Math.round(((precoDe - preco) / precoDe) * 100);
}

function detectPlatform(url) {
  try {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('mercadolivre') || urlLower.includes('ml.')) return 'mercadolivre';
    if (urlLower.includes('shopee')) return 'shopee';
    if (urlLower.includes('aliexpress') || urlLower.includes('ali.')) return 'aliexpress';
    if (urlLower.includes('amazon')) return 'amazon';
  } catch (e) {
    logger.warn({ erro: e.message, msg: 'Erro ao detectar plataforma' });
  }
  return 'desconhecida';
}

const AFFILIATE_ID = 'eahgdbefc60983';

function buildAffiliateLink(url) {
  if (!url) return url;
  if (url.includes('matt_tool=')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}matt_tool=${AFFILIATE_ID}`;
}

async function fetchFeedWithRetry(feed, attempt = 1) {
  const cacheKey = `rss_${feed.name}`;
  const cached = rssCache.get(cacheKey);
  if (cached) return cached;

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ];

  try {
    logger.info({ feed: feed.name, url: feed.url, attempt, msg: 'Buscando feed' });
    const response = await axios.get(feed.url, {
      timeout: DEFAULT_TIMEOUT,
      headers: { 
        'User-Agent': userAgents[attempt % userAgents.length],
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    logger.info({ feed: feed.name, status: response.status, msg: 'Feed recebido' });
    const parsed = await parser.parseString(response.data);
    rssCache.set(cacheKey, parsed, 10 * 60 * 1000);
    return parsed;
  } catch (err) {
    logger.error({ feed: feed.name, erro: err.message, attempt, msg: 'Erro ao buscar feed' });
    
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000 * attempt));
      return fetchFeedWithRetry(feed, attempt + 1);
    }
    
    return null;
  }
}

export async function collect() {
  const minDiscount = parseInt(process.env.MIN_DISCOUNT_DEFAULT) || 30;
  const allOffers = [];

  for (const feed of RSS_FEEDS) {
    const parsed = await fetchFeedWithRetry(feed);
    if (!parsed) {
      logger.warn({ feed: feed.name, msg: 'Feed indisponível, continuando...' });
      continue;
    }

    for (const item of parsed.items || []) {
      try {
        const link = item.link || item.url;
        if (!link) continue;

        const plataforma = detectPlatform(link);
        const { preco, preco_de } = extractPrice(item.contentSnippet || item.title || '');

        let discountPct = 0;
        const discountMatch = (item.contentSnippet || item.title || '').match(/(\d+)%\s*(?:OFF|off)/i);
        if (discountMatch) {
          discountPct = parseInt(discountMatch[1]);
        } else {
          discountPct = calculateDiscount(preco, preco_de);
        }

        if (discountPct < minDiscount || preco <= 0) continue;

        const linkAfiliado = injectAffiliate(link, plataforma);

        allOffers.push({
          titulo: (item.title || 'Oferta').substring(0, 200),
          preco,
          preco_de: preco_de || preco,
          desconto_pct: discountPct,
          link_afiliado: buildAffiliateLink(link),
          imagem_url: item.enclosure?.url || null,
          plataforma,
          fonte: feed.name,
        });
      } catch (err) {
        logger.error({ erro: err.message, msg: 'Erro ao processar item' });
      }
    }

    await new Promise((r) => setImmediate(r));
  }

  logger.info({ ofertas: allOffers.length, fonte: 'rss' });
  return allOffers;
}

export default { collect };