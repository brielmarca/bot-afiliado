import Parser from 'rss-parser';
import axios from 'axios';
import logger from '../utils/logger.js';
import { rssCache } from '../utils/cache.js';

const parser = new Parser({ timeout: 10000 });

const SHOPEE_RSS_URL = 'https://www.promobit.com.br/feed/offers';
const MAX_RETRIES = 2;

function extractPrice(text) {
  const match = text.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
}

const AFFILIATE_ID = 'eahgdbefc60983';

function buildAffiliateLink(url) {
  if (!url) return url;
  if (url.includes('matt_tool=')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}matt_tool=${AFFILIATE_ID}`;
}
    return url;
  }
}

function detectPlatform(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('shopee')) return 'shopee';
  if (urlLower.includes('mercadolivre')) return 'mercadolivre';
  if (urlLower.includes('aliexpress')) return 'aliexpress';
  if (urlLower.includes('amazon')) return 'amazon';
  return 'desconhecida';
}

async function fetchWithRetry(attempt = 1) {
  const cacheKey = 'shopee_rss';
  const cached = rssCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await axios.get(SHOPEE_RSS_URL, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const feed = await parser.parseString(response.data);
    const minDiscount = parseInt(process.env.MIN_DISCOUNT_DEFAULT) || 30;

    const offers = [];

    for (const item of feed.items || []) {
      try {
        const link = item.link || item.url;
        if (!link || !link.toLowerCase().includes('shopee')) {
          continue;
        }

        const price = extractPrice(item.contentSnippet || item.title) || 0;
        const title = item.title || 'Produto Shopee';

        let discountPct = 0;
        const discountMatch = (item.contentSnippet || item.title).match(/(\d+)%\s*(?:OFF|off)/i);
        if (discountMatch) {
          discountPct = parseInt(discountMatch[1]);
        }

        if (discountPct < minDiscount) continue;

        const plataforma = detectPlatform(link);
        const linkAfiliado = buildAffiliateLink(link);

        offers.push({
          titulo: title.substring(0, 200),
          preco: price,
          preco_de: price,
          desconto_pct: discountPct,
          link_afiliado: linkAfiliado,
          imagem_url: item.enclosure?.url || null,
          plataforma,
          fonte: 'promobit_rss',
        });
      } catch (err) {
        logger.error({ erro: err.message, msg: 'Erro ao processar item Shopee' });
      }
    }

    logger.info({ ofertas: offers.length, fonte: 'shopee_rss' });
    rssCache.set(cacheKey, offers, 10 * 60 * 1000);
    return offers;
  } catch (err) {
    logger.error({ erro: err.message, attempt, fonte: 'shopee' });
    
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchWithRetry(attempt + 1);
    }
    
    return [];
  }
}

export async function collect() {
  return fetchWithRetry();
}

export default { collect };