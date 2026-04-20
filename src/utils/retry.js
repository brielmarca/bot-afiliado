import logger from './logger.js';

const TRANSIENT_ERRORS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
];

const RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

function isTransientError(error) {
  if (error.code && TRANSIENT_ERRORS.includes(error.code)) return true;
  if (error.response?.status && RETRY_STATUS_CODES.includes(error.response.status)) return true;
  return false;
}

async function withRetry(fn, options = {}) {
  const { retries = 3, baseDelayMs = 1000, label = 'operation' } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isTransientError(error)) {
        throw error;
      }

      if (attempt === retries) {
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn({
        msg: `Retry ${label}`,
        attempt,
        retries,
        delay,
        error: error.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export { withRetry, isTransientError };