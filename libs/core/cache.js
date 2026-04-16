const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');

// 缓存版本号，用于结构升级
const CACHE_VERSION = 4;

/**
 * 读取缓存文件
 *
 * @param {string} cachePath
 */
async function loadCache(cachePath) {
  const exists = await fs.pathExists(cachePath);
  if (!exists) {
    return { version: CACHE_VERSION, meta: {}, files: {} };
  }

  try {
    const data = await fs.readJson(cachePath);
    if (data && typeof data === 'object') {
      const parsedVersion = Number.isFinite(Number(data.version)) ? Number(data.version) : 0;
      return {
        version: parsedVersion,
        meta: data.meta || {},
        files: data.files || {},
      };
    }
    return { version: CACHE_VERSION, meta: {}, files: {} };
  } catch {
    return { version: CACHE_VERSION, meta: {}, files: {} };
  }
}

/**
 * 写入缓存文件
 *
 * @param {string} cachePath
 * @param {{version: number, meta: Record<string, any>, files: Record<string, any>}} cache
 */
async function saveCache(cachePath, cache) {
  await fs.writeJson(cachePath, cache, { spaces: 2 });
}

/**
 * 计算文件内容哈希
 *
 * @param {string} filePath
 */
async function computeFileHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * 生成稳定的缓存键
 *
 * @param {string} filePath
 * @param {string} rootDir
 * @param {{target?: string, jsonSpaces?: number, languages?: string[]}} options
 */
function buildCacheKey(filePath, rootDir, options = {}) {
  const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
  const rawTarget = (options.target || 'both').toLowerCase();
  const target = ['server', 'client', 'both'].includes(rawTarget) ? rawTarget : 'both';
  const jsonSpaces = typeof options.jsonSpaces === 'number' ? options.jsonSpaces : 2;
  const languages = normalizeLanguages(options.languages);
  return `${relativePath}?target=${target}&spaces=${jsonSpaces}&lang=${languages}`;
}

function normalizeLanguages(languages) {
  if (!Array.isArray(languages) || languages.length === 0) {
    return 'ts';
  }
  return languages
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

module.exports = {
  CACHE_VERSION,
  loadCache,
  saveCache,
  computeFileHash,
  buildCacheKey,
};
