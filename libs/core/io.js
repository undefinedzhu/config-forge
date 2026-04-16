const fs = require('fs-extra');
const glob = require('glob');

/**
 * 根据命令行传入的路径解析出所有 .xlsx 文件
 *
 * @param {string} inputPath 目录路径 / 单个文件路径
 * @returns {Promise<string[]>} 绝对路径数组
 */
async function resolveXlsxFiles(inputPath) {
  const stat = await fs.stat(inputPath).catch(() => null);

  if (!stat) {
    const files = glob.sync('**/*.xlsx', { cwd: inputPath, absolute: true });
    return files;
  }

  if (stat.isDirectory()) {
    const files = glob.sync('**/*.xlsx', { cwd: inputPath, absolute: true });
    return files;
  }

  if (stat.isFile() && inputPath.toLowerCase().endsWith('.xlsx')) {
    return [inputPath];
  }

  return [];
}

module.exports = {
  resolveXlsxFiles,
};
