import axios from 'axios';
import logger from '../utils/logger.js';
import { rssCache } from '../utils/cache.js';

const AFFILIATE_ID = 'eahgdbefc60983';

function buildAffiliateLink(url) {
  if (!url) return url;
  if (url.includes('matt_tool=')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}matt_tool=${AFFILIATE_ID}`;
}

const SITES = [
  {
    name: 'pelando',
    url: 'https://www.pelando.com.br',
    searchPath: '/ofertas',
  },
  {
    name: 'promobit',
    url: 'https://www.promobit.com.br',
    searchPath: '/ofertas',
  },
];

const DEFAULT_TIMEOUT = 15000;

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
  const urlLower = url.toLowerCase();
  if (urlLower.includes('mercadolivre') || urlLower.includes('ml.')) return 'mercadolivre';
  if (urlLower.includes('shopee')) return 'shopee';
  if (urlLower.includes('aliexpress') || urlLower.includes('ali.')) return 'aliexpress';
  if (urlLower.includes('amazon')) return 'amazon';
  return 'desconhecida';
}

async function fetchSiteHTML(site) {
  const cacheKey = `html_${site.name}`;
  const cached = rssCache.get(cacheKey);
  if (cached) return cached;

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  try {
    logger.info({ site: site.name, url: site.url, msg: 'Buscando página HTML' });
    const response = await axios.get(site.url, {
      timeout: DEFAULT_TIMEOUT,
      headers: { 
        'User-Agent': userAgents[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    logger.info({ site: site.name, status: response.status, size: response.data?.length, msg: 'Página recebida' });
    rssCache.set(cacheKey, response.data, 10 * 60 * 1000);
    return response.data;
  } catch (err) {
    logger.error({ site: site.name, erro: err.message, msg: 'Erro ao buscar página' });
    return null;
  }
}

function parseHTMLToOffers(html, sourceName) {
  const offers = [];
  const minDiscount = parseInt(process.env.MIN_DISCOUNT_DEFAULT) || 30;
  
  if (!html) return offers;

  const linkRegex = /href="(https?:\/\/[^"'>]+)"/gi;
  const titleRegex = /<a[^>]*title="([^">]+)"/gi;
  const priceRegex = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g;

  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    if (url.includes('mercadolivre') || url.includes('shopee') || url.includes('amazon') || url.includes('aliexpress')) {
      if (!links.includes(url)) links.push(url);
    }
  }

  for (const url of links) {
    const plataforma = detectPlatform(url);
    if (plataforma === 'desconhecida') continue;

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const titulo = pathParts[pathParts.length - 1]?.replace(/-/g, ' ').substring(0, 100) || 'Produto';

    offers.push({
      titulo,
      preco: 0,
      preco_de: 0,
      desconto_pct: 0,
      link_afiliado: buildAffiliateLink(url),
      imagem_url: null,
      plataforma,
      fonte: sourceName,
    });
  }

  return offers;
}

export async function collect() {
  const allOffers = [];

  for (const site of SITES) {
    const html = await fetchSiteHTML(site);
    if (!html) continue;

    const offers = parseHTMLToOffers(html, site.name);
    allOffers.push(...offers);
  }

  logger.info({ ofertas: allOffers.length, fonte: 'scraper' });
  return allOffers;
}

export default { collect };