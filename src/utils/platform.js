export function detectPlatform(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('mercadolivre') || urlLower.includes('ml.')) return 'mercadolivre';
  if (urlLower.includes('shopee')) return 'shopee';
  if (urlLower.includes('aliexpress') || urlLower.includes('ali.')) return 'aliexpress';
  if (urlLower.includes('amazon')) return 'amazon';
  return 'desconhecida';
}