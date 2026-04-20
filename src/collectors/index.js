import mercadolivre from './mercadolivre.js';
import shopee from './shopee.js';
import rss from './rss.js';
import logger from '../utils/logger.js';

export async function coletarTodas() {
  const results = await Promise.allSettled([
    mercadolivre.collect(),
    shopee.collect(),
    rss.collect(),
  ]);

  let allOffers = [];

  if (results[0].status === 'fulfilled') {
    allOffers.push(...results[0].value);
  } else {
    logger.error({ collector: 'mercadolivre', erro: results[0].reason?.message });
  }

  if (results[1].status === 'fulfilled') {
    allOffers.push(...results[1].value);
  } else {
    logger.error({ collector: 'shopee', erro: results[1].reason?.message });
  }

  if (results[2].status === 'fulfilled') {
    allOffers.push(...results[2].value);
  } else {
    logger.error({ collector: 'rss', erro: results[2].reason?.message });
  }

  logger.info({
    total: allOffers.length,
    msg: 'Coleta concluída',
  });

  return allOffers;
}

export default { coletarTodas };