import axios from 'axios';
import logger from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const ML_API_BASE = 'https://api.mercadolibre.com';
let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 15 * 60 * 1000) {
    return accessToken;
  }

  const response = await withRetry(
    async () =>
      await axios.post(
        `${ML_API_BASE}/oauth/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.ML_CLIENT_ID,
          client_secret: process.env.ML_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      ),
    { retries: 3, label: 'ML OAuth' }
  );

  const data = response.data;
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  logger.info({ msg: 'Token ML atualizado', expiresIn: data.expires_in });
  return accessToken;
}

function buildAffiliateLink(permalink) {
  const partnerId = process.env.ML_PARTNER_ID;
  if (!partnerId) {
    logger.warn({ msg: 'ML_PARTNER_ID não configurado' });
    return permalink;
  }
  const separator = permalink.includes('?') ? '&' : '?';
  return `${permalink}${separator}tag=${partnerId}`;
}

export async function collect() {
  const minDiscount = parseInt(process.env.MIN_DISCOUNT_DEFAULT) || 30;
  const queries = ['celulares', 'informatica', 'eletronicos', 'moda', 'casa', 'beleza'];
  const allOffers = [];

  const token = await getAccessToken();

  for (const query of queries) {
    try {
      const response = await withRetry(
        async () =>
          await axios.get(`${ML_API_BASE}/sites/MLB/search`, {
            params: {
              q: query,
              limit: 50,
              sort: 'price_asc',
              condition: 'new',
            },
            headers: { Authorization: `Bearer ${token}` },
          }),
        { retries: 3, label: `ML search ${query}` }
      );

      const results = response.data.results || [];

      const filtered = results
        .filter((item) => {
          const originalPrice = item.original_price || item.price;
          const currentPrice = item.price;
          if (!originalPrice || originalPrice <= currentPrice) return false;
          const discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
          return discount >= minDiscount;
        })
        .map((item) => {
          const originalPrice = item.original_price || item.price;
          const currentPrice = item.price;
          const discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);

          return {
            titulo: item.title,
            preco: currentPrice,
            preco_de: originalPrice,
            desconto_pct: discount,
            link_afiliado: buildAffiliateLink(item.permalink),
            imagem_url: item.thumbnail,
            plataforma: 'mercadolivre',
            fonte: 'ml-api',
          };
        });

      allOffers.push(...filtered);
      logger.info({ query, ofertas: filtered.length });
    } catch (err) {
      logger.error({ query, erro: err.message });
    }

    await new Promise((r) => setImmediate(r));
  }

  return allOffers;
}

export default { collect };