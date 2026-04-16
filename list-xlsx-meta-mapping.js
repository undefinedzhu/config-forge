#!/usr/bin/env node

/**
 * 遍历目录中的 XLSX，读取 __meta__ Sheet 里的 SheetName，输出 SheetName 与文件名映射表。
 *
 * 约定：
 * - 与 convert-xlsx-to-config.js 相同，工作目录切换到项目根目录。
 * - 默认输入目录：input/xlsx
 * - 默认输出文件：输入目录下的「配置表映射.txt」
 * - __meta__ 首行是表头，包含 SheetName 列；从第二行起读取数据。
 *
 * 使用示例（在项目根目录执行）：
 * ```bash
 * # 默认输入目录
 * node list-xlsx-meta-mapping.js
 *
 * # 指定自定义目录
 * node list-xlsx-meta-mapping.js --input path/to/xlsx_dir
 *
 * # 指定映射文件输出目录
 * node list-xlsx-meta-mapping.js --input path/to/xlsx_dir --out-dir path/to/output_dir
 * ```
 */

const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const chalk = require('chalk');

// 统一切换到项目根目录，保证相对路径一致
process.chdir(path.resolve(__dirname));

/**
 * 解析命令行参数
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const args = {
    input: 'input/xlsx',
    outDir: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' || arg === '--in' || arg === '-i') {
      args.input = argv[i + 1] || args.input;
      i++;
    } else if (arg === '--out-dir' || arg === '--out' || arg === '-o') {
      args.outDir = argv[i + 1] || args.outDir;
      i++;
    }
  }

  return args;
}

/**
 * 解析 __meta__ Sheet，返回其中的 SheetName 列
 * @param {import('exceljs').Workbook} workbook
 * @returns {string[]} sheetNames
 */
function readMetaSheet(workbook) {
  const metaSheet = workbook.getWorksheet('__meta__');
  if (!metaSheet) {
    return [];
  }

  const headerRow = metaSheet.getRow(1);
  const headers = {};

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = String(cell.value || '').trim();
    if (key) {
      headers[key] = colNumber;
    }
  });

  const sheetNames = [];

  for (let r = 2; r <= metaSheet.rowCount; r++) {
    const row = metaSheet.getRow(r);
    const sheetName = getCellString(row, headers['SheetName']);
    if (sheetName) {
      sheetNames.push(sheetName);
    }
  }

  return sheetNames;
}

/**
 * 将单元格内容转换为字符串
 * @param {import('exceljs').Row} row
 * @param {number | undefined} colIndex
 */
function getCellString(row, colIndex) {
  if (!row || !colIndex) return '';
  const cell = row.getCell(colIndex);
  if (!cell) return '';

  const v = cell.value;
  if (v === null || v === undefined) return '';

  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';

  if (v.text) return String(v.text).trim();
  if (v.richText) return v.richText.map((t) => t.text).join('').trim();

  return String(v).trim();
}

/**
 * 匹配目录内所有 .xlsx 文件
 * @param {string} inputPath
 * @returns {Promise<string[]>}
 */
function resolveXlsxFiles(inputPath) {
  const files = glob.sync('**/*.xlsx', {
    cwd: inputPath,
    absolute: true,
    nodir: true,
  });
  return Promise.resolve(files);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const inputPath = path.resolve(projectRoot, args.input);
  const outputDir = path.resolve(projectRoot, args.outDir || args.input);
  const outputFile = path.join(outputDir, '配置表映射.txt');

  console.log(chalk.blue.bold('🔎 XLSX SheetName 映射提取'));
  console.log(chalk.cyan(`📂 项目根目录: ${projectRoot}`));
  console.log(chalk.cyan(`📥 输入路径: ${inputPath}`));
  console.log(chalk.cyan(`📄 输出文件: ${outputFile}`));

  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (err) {
    console.error(chalk.red('❌ 需要 exceljs 依赖才能读取 XLSX。'));
    console.error(chalk.yellow('   请先运行: npm install exceljs --save-dev'));
    process.exit(1);
  }

  // 确保输入目录存在
  const inputExists = await fs.pathExists(inputPath);
  if (!inputExists) {
    console.error(chalk.red('❌ 输入目录不存在，请检查路径。'));
    process.exit(1);
  }

  const xlsxFiles = await resolveXlsxFiles(inputPath);
  if (!xlsxFiles.length) {
    console.log(chalk.yellow('⚠️ 未找到任何 .xlsx 文件。'));
    return;
  }

  console.log(chalk.cyan(`🔍 找到 ${xlsxFiles.length} 个 XLSX 文件，开始解析 __meta__ ...`));

  /** @type {Record<string, Set<string>>} */
  const mapping = {};

  for (const file of xlsxFiles) {
    const relativeName = path.relative(projectRoot, file);
    const fileBase = path.basename(file, path.extname(file));
    console.log(chalk.blue(`\n➡  处理: ${relativeName}`));

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);

      const sheetNames = readMetaSheet(workbook);

      if (!sheetNames.length) {
        console.log(chalk.yellow('  ⚠️ __meta__ Sheet 为空或缺失，已跳过'));
        continue;
      }

      for (const name of sheetNames) {
        if (!mapping[name]) {
          mapping[name] = new Set();
        }
        mapping[name].add(fileBase);
      }
    } catch (err) {
      console.error(chalk.red('  ❌ 读取 XLSX 失败:'), err.message || err);
    }
  }

  console.log('\n📄 SheetName -> XLSX 映射：');
  if (!Object.keys(mapping).length) {
    console.log(chalk.yellow('⚠️ 未提取到任何 SheetName，请检查 __meta__ Sheet。'));
    return;
  }

  const sortedNames = Object.keys(mapping).sort();
  const lines = [];
  for (const name of sortedNames) {
    const files = Array.from(mapping[name]).sort();
    const line = `${name}:${files.join(',')}`;
    lines.push(line);
    console.log(`- ${line}`);
  }

  await fs.ensureDir(outputDir);
  await fs.writeFile(outputFile, `${lines.join('\n')}\n`, 'utf-8');
  console.log(chalk.green(`\n✅ 已写入映射文件: ${outputFile}`));
}

main().catch((err) => {
  console.error(chalk.red('❌ 未知错误'), err);
  process.exit(1);
});
