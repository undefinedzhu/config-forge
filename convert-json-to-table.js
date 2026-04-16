#!/usr/bin/env node

/**
 * 通用 JSON → CSV / XLSX 导出工具
 *
 * 设计用途：
 *   - 将运行时使用的 JSON 配置（例如 libs/game-config/src/data 下的 *.json）
 *     反向导出为 CSV / XLSX，方便策划或美术在表格工具中查看与编辑。
 *
 * 默认行为：
 *   - 扫描指定数据目录下的所有 *.json
 *   - 只处理顶层为数组的 JSON 文件（[{...}, {...}]）
 *   - 合并所有对象的 key 作为表头（字段集合的并集）
 *   - 为每个 JSON 文件导出同名的 .csv 和/或 .xlsx 到指定输出目录
 *     （分别存放在 csv/ 和 xlsx/ 子目录）
 *
 * 使用示例（在项目根目录）：
 *   node convert-json-to-table.js
 *   node convert-json-to-table.js --format xlsx
 *   node convert-json-to-table.js --format csv,xlsx
 *   node convert-json-to-table.js --out-dir input
 *
 * XLSX 导出遵循《config-spreadsheet-spec》中的规范：
 *   - 每个工作簿包含一个配置 Sheet（5 行表头 + 数据）
 *   - 以及一个 `__meta__` Sheet，记录 SheetName/TableName/JsonFileName/PrimaryKey 等元数据
 *   - 生成的 XLSX 可以直接作为 convert-xlsx-to-config.js 的输入继续正向生成
 *
 * CSV 仅用于简单导出（单行表头 + 数据），主要面向人工查看/临时导入，
 * 不参与后续 JSON/interface 生成链路。
 */

const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const chalk = require('chalk');

/**
 * CLI 入口函数
 *
 * 负责：
 *   - 解析命令行参数
 *   - 解析输入输出路径与导出格式
 *   - 扫描并读取 JSON 文件
 *   - 依次导出 CSV/XLSX 表格
 *   - 输出简要的统计信息
 */
async function main() {
  try {
    const projectRoot = path.resolve(__dirname);
    process.chdir(projectRoot);

    const args = parseArgs(process.argv.slice(2));
    const dataDir = path.resolve(projectRoot, args.dataDir);
    const outDir = path.resolve(projectRoot, args.outDir);
    const formats = args.formats; // Set<'csv' | 'xlsx'>

    const csvDir = path.join(outDir, 'csv');
    const xlsxDir = path.join(outDir, 'xlsx');

    await fs.ensureDir(outDir);
    if (formats.has('csv')) {
      await fs.ensureDir(csvDir);
    }
    if (formats.has('xlsx')) {
      await fs.ensureDir(xlsxDir);
    }

    console.log(chalk.cyan(`📂 项目根目录: ${projectRoot}`));
    console.log(chalk.cyan(`📄 JSON 目录: ${dataDir}`));
    console.log(chalk.cyan(`📁 导出目录: ${outDir}`));
    if (formats.has('csv')) {
      console.log(chalk.cyan(`   ├─ CSV:  ${csvDir}`));
    }
    if (formats.has('xlsx')) {
      console.log(chalk.cyan(`   └─ XLSX: ${xlsxDir}`));
    }
    console.log(chalk.cyan(`📑 导出格式: ${Array.from(formats).join(', ')}`));

    let ExcelJS = null;
    if (formats.has('xlsx')) {
      try {
        // 按需加载，避免未安装 exceljs 时影响 CSV 导出
        ExcelJS = require('exceljs');
      } catch (err) {
        console.error(chalk.red('❌ 需要导出 XLSX，但未安装依赖包 "exceljs"。'));
        console.error(chalk.yellow('   请先运行: npm install exceljs --save-dev'));
        console.error(chalk.yellow('   本次将仅导出 CSV。'));
        formats.delete('xlsx');
      }
    }

    // 在 Windows 上，绝对路径中的反斜杠会在 glob 中被当作转义字符（例如 \f、\s），
    // 因此使用 cwd + 相对模式的方式更安全
    const files = glob.sync('*.json', { cwd: dataDir, absolute: true });

    if (!files.length) {
      console.log(chalk.yellow('⚠️ 未找到任何 JSON 文件。'));
      return;
    }

    console.log(chalk.cyan(`🔍 找到 ${files.length} 个 JSON 文件`));

    let csvCount = 0;
    let xlsxCount = 0;

    for (const file of files) {
      const baseName = path.basename(file, '.json');
      console.log(chalk.blue(`
➡  处理: ${baseName}.json`));

      let raw;
      try {
        raw = await fs.readFile(file, 'utf-8');
      } catch (err) {
        console.error(chalk.red(`  ❌ 读取文件失败: ${file}`));
        console.error(chalk.red(`     ${err.message}`));
        continue;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        console.error(chalk.red(`  ❌ 解析 JSON 失败: ${file}`));
        console.error(chalk.red(`     ${err.message}`));
        continue;
      }

      if (!Array.isArray(data)) {
        console.log(chalk.yellow('  ⚠️ 顶层不是数组，已跳过（期望为 [ {...}, {...} ] ）'));
        continue;
      }

      if (!data.length) {
        console.log(chalk.yellow('  ⚠️ 数组为空，已跳过（无数据可导出）'));
        continue;
      }

      const headers = collectHeaders(data);
      if (!headers.length) {
        console.log(chalk.yellow('  ⚠️ 未找到任何字段，已跳过'));
        continue;
      }

      if (formats.has('csv')) {
        const csvPath = path.join(csvDir, `${baseName}.csv`);
        try {
          // 在内容前添加 UTF-8 BOM，确保 Excel 识别为 UTF-8，中文不乱码
          const csvContent = '\uFEFF' + toCsv(headers, data);
          await fs.writeFile(csvPath, csvContent, 'utf-8');
          console.log(chalk.green(`  ✅ 导出 CSV: ${csvPath}`));
          csvCount++;
        } catch (err) {
          console.error(chalk.red(`  ❌ 导出 CSV 失败: ${csvPath}`));
          console.error(chalk.red(`     ${err.message}`));
        }
      }

      if (formats.has('xlsx') && ExcelJS) {
        const xlsxPath = path.join(xlsxDir, `${baseName}.xlsx`);
        try {
          const sheetName = sanitizeSheetName(baseName);

          const workbook = new ExcelJS.Workbook();

          // 配置 Sheet：5 行表头（显示名/字段名/类型/server/client）+ 数据
          const worksheetData = buildWorksheetData(headers, data);
          const configSheet = workbook.addWorksheet(sheetName);
          worksheetData.forEach((rowValues) => {
            configSheet.addRow(rowValues);
          });

          // 美化前 5 行表头样式
          applyHeaderStyles(configSheet, headers.length);

          // __meta__ Sheet：记录表级元数据
          const metaData = buildMetaWorksheetData(sheetName, path.basename(file), headers);
          const metaSheet = workbook.addWorksheet('__meta__');
          metaData.forEach((rowValues) => {
            metaSheet.addRow(rowValues);
          });

          await workbook.xlsx.writeFile(xlsxPath);
          console.log(chalk.green(`  ✅ 导出 XLSX: ${xlsxPath}`));
          xlsxCount++;
        } catch (err) {
          console.error(chalk.red(`  ❌ 导出 XLSX 失败: ${xlsxPath}`));
          console.error(chalk.red(`     ${err.message}`));
        }
      }
    }

    console.log(chalk.green('\n🎉 导出完成'));
    if (formats.has('csv')) {
      console.log(chalk.green(`   CSV 文件数: ${csvCount}`));
    }
    if (formats.has('xlsx')) {
      console.log(chalk.green(`   XLSX 文件数: ${xlsxCount}`));
    }
  } catch (err) {
    console.error(chalk.red('❌ 导出过程发生未捕获错误'));
    console.error(err);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 *
 * 支持参数：
 *   --data-dir=<path>   JSON 源数据目录（默认 ../server/libs/game-config/src/data）
 *   --out-dir=<path>    导出目录（默认 input）
 *   --format=<spec>     导出格式：csv | xlsx | both | 逗号分隔（如 csv,xlsx）
 *
 * @param {string[]} argv 传入的 argv 列表（不含 node 与脚本名）
 * @returns {{ dataDir: string, outDir: string, formats: Set<'csv'|'xlsx'> }}
 */
function parseArgs(argv) {
  let dataDir = '../server/libs/game-config/src/data';
  let outDir = 'input';
  let formatSpec = 'csv';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--data-dir' && argv[i + 1]) {
      dataDir = argv[++i];
    } else if (arg.startsWith('--data-dir=')) {
      dataDir = arg.split('=')[1];
    } else if (arg === '--out-dir' && argv[i + 1]) {
      outDir = argv[++i];
    } else if (arg.startsWith('--out-dir=')) {
      outDir = arg.split('=')[1];
    } else if (arg === '--format' && argv[i + 1]) {
      formatSpec = argv[++i];
    } else if (arg.startsWith('--format=')) {
      formatSpec = arg.split('=')[1];
    }
  }

  const formats = new Set();
  const parts = formatSpec
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const part of parts) {
    if (part === 'csv' || part === 'xlsx') {
      formats.add(part);
    } else if (part === 'both') {
      formats.add('csv');
      formats.add('xlsx');
    }
  }

  if (!formats.size) {
    formats.add('csv');
  }

  return { dataDir, outDir, formats };
}

/**
 * 收集 JSON 数组中所有对象的 key，作为表头字段集合
 *
 * @param {Array<any>} rows 顶层数组数据
 * @returns {string[]} 去重后的字段名数组
 */
function collectHeaders(rows) {
  const keys = new Set();
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        keys.add(key);
      }
    }
  }
  return Array.from(keys);
}

/**
 * 将数据转换为简单的 CSV 文本
 *
 * 第一行是字段名表头，后续每行为一条记录；
 * 字符串中包含逗号/引号/换行时会进行适当转义。
 *
 * @param {string[]} headers 字段名表头
 * @param {Array<any>} rows  数据行数组
 * @returns {string} CSV 文本内容（不包含 BOM）
 */
function toCsv(headers, rows) {
  const lines = [];
  lines.push(headers.join(','));

  for (const row of rows) {
    const values = headers.map((h) => formatCsvValue(row ? row[h] : undefined));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * 将单元格值格式化为 CSV 可安全表示的字符串
 *
 * - null/undefined → 空字符串
 * - number/boolean → 直接转为字符串
 * - 对象/数组 → JSON.stringify 后再按 CSV 规则转义
 *
 * @param {any} value 原始值
 * @returns {string} 已转义的字符串
 */
function formatCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value) || typeof value === 'object') {
    value = JSON.stringify(value);
  }

  let text = String(value);

  if (/[",\n\r]/.test(text)) {
    text = '"' + text.replace(/"/g, '""') + '"';
  }

  return text;
}

/**
 * 构建配置 Sheet（配置工作表）的完整二维数组数据
 *
 * 结构：
 *   行1：显示名（当前简单使用字段名，主键字段带 [PK]）
 *   行2：字段名（fieldName）
 *   行3：推断出的类型（int / float / string / bool / json / T[]）
 *   行4：server 标记（默认全部为 'server'）
 *   行5：client 标记（默认全部为 'client'）
 *   行6+：逐行数据
 *
 * @param {string[]} headers 表头字段名
 * @param {Array<any>} rows  原始数据行
 * @returns {Array<any[]>} 适合直接写入 ExcelJS 的行数组
 */
function buildWorksheetData(headers, rows) {
  // 推断主键：优先使用 id，否则使用第一个字段
  const primaryKey = headers.includes('id') ? 'id' : headers[0];
  const fieldTypes = inferFieldTypes(headers, rows);

  // 行1：显示名（附加 [PK] 标记）
  const displayRow = headers.map((h) => (h === primaryKey ? `${h}[PK]` : h));
  // 行2：字段名
  const fieldRow = headers.slice();
  // 行3：类型
  const typeRow = headers.map((h) => fieldTypes[h] || 'string');
  // 行4：server 标记（默认全部对 server 可见）
  const serverRow = headers.map(() => 'server');
  // 行5：client 标记（默认全部对 client 可见）
  const clientRow = headers.map(() => 'client');

  const data = [];
  data.push(displayRow);
  data.push(fieldRow);
  data.push(typeRow);
  data.push(serverRow);
  data.push(clientRow);

  // 行6+：数据
  for (const row of rows) {
    const values = headers.map((h) => formatWorksheetValue(row ? row[h] : undefined));
    data.push(values);
  }

  return data;
}

/**
 * 根据数据内容推断每个字段的类型
 *
 * 优先从非空数据中取第一个可识别的值作为类型样本：
 *   - number → int/float
 *   - boolean → bool
 *   - string → string
 *   - object → json
 *   - array  → 元素类型 + []
 *
 * @param {string[]} headers 字段名列表
 * @param {Array<any>} rows  数据行列表
 * @returns {Record<string,string>} 字段名 → 推断类型
 */
function inferFieldTypes(headers, rows) {
  const types = {};

  for (const header of headers) {
    types[header] = inferSingleFieldType(header, rows);
  }

  return types;
}

/**
 * 为单个字段推断类型
 *
 * 从上到下扫描数据行，遇到第一个非空值时：
 *   - 如果是数组，则根据第一个非空元素推断元素类型，并返回 "T[]" 形式
 *   - 如果是 number / boolean / string / object，分别映射为 int/float/bool/string/json
 *   - 如果无法判断，则回退为 string
 *
 * @param {string} header 字段名
 * @param {Array<any>} rows 数据行
 * @returns {string} 推断出的类型字符串
 */
function inferSingleFieldType(header, rows) {
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }

    const value = row[header];

    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      // 推断数组元素类型
      let elemType = 'string';

      for (const v of value) {
        if (v === null || v === undefined) {
          continue;
        }

        if (typeof v === 'number') {
          elemType = Number.isInteger(v) ? 'int' : 'float';
        } else if (typeof v === 'boolean') {
          elemType = 'bool';
        } else {
          elemType = 'string';
        }
        break;
      }

      return `${elemType}[]`;
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'int' : 'float';
    }

    if (typeof value === 'boolean') {
      return 'bool';
    }

    if (typeof value === 'string') {
      return 'string';
    }

    if (typeof value === 'object') {
      return 'json';
    }
  }

  return 'string';
}

/**
 * 将值格式化为写入 Excel 配置 Sheet 的单元格文本
 *
 * - null/undefined → 空字符串
 * - 数组 → 用逗号连接，便于策划在表格中编辑
 * - 对象 → JSON.stringify
 * - 其他 → 直接返回
 *
 * @param {any} value 原始值
 * @returns {string} 适合写入单元格的文本
 */
function formatWorksheetValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    // 使用逗号分隔，便于策划编辑
    return value.join(',');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}

/**
 * 构建 __meta__ Sheet 的数据
 *
 * 当前实现仅生成一行简单的表级元数据，方便后续工具识别：
 *   - SheetName
 *   - TableName（对当前工具来说等同于 SheetName）
 *   - JsonFileName
 *   - PrimaryKey（优先 id，退化为首字段）
 *   - Description（留空，供人工填写）
 *
 * @param {string} sheetName   配置 Sheet 名称
 * @param {string} jsonFileName 源 JSON 文件名
 * @param {string[]} headers   所有字段名
 * @returns {Array<any[]>} 适合写入 ExcelJS 的 meta 行数组
 */
function buildMetaWorksheetData(sheetName, jsonFileName, headers) {
  const tableName = sheetName || 'Sheet1';
  const primaryKey = headers.includes('id') ? 'id' : headers[0];

  const headerRow = ['SheetName', 'TableName', 'JsonFileName', 'PrimaryKey', 'Description'];
  const dataRow = [
    sheetName,
    tableName,
    jsonFileName || `${tableName}.json`,
    primaryKey,
    '',
  ];

  return [headerRow, dataRow];
}

/**
 * 为配置 Sheet 的前 5 行表头设置基础样式
 *
 * - 不同表头行使用不同的淡色背景，帮助策划区分含义
 * - 加粗字体，设置细边框，避免完全依赖 Excel 默认网格
 *
 * @param {import('exceljs').Worksheet} worksheet 目标工作表
 * @param {number} columnCount              表头列数
 */
function applyHeaderStyles(worksheet, columnCount) {
  const headerRows = 5;

  for (let r = 1; r <= headerRows; r++) {
    const row = worksheet.getRow(r);

    // 为不同表头行设置不同的淡色背景，提高区分度
    // 1: 显示名, 2: 字段名, 3: 类型, 4: server 标记, 5: client 标记
    let fillColor;
    switch (r) {
      case 1:
        fillColor = 'FFD9D9D9'; // 稍深灰，强调主显示名
        break;
      case 2:
        fillColor = 'FFEFEFEF'; // 浅灰，字段名
        break;
      case 3:
        fillColor = 'FFF7F7F7'; // 更浅灰，类型
        break;
      case 4:
        fillColor = 'FFE0F2FF'; // 淡蓝，server
        break;
      case 5:
        fillColor = 'FFE0FFE0'; // 淡绿，client
        break;
      default:
        fillColor = 'FFEFEFEF';
    }

    for (let c = 1; c <= columnCount; c++) {
      const cell = row.getCell(c);

      if (cell === undefined) continue;

      // 加粗字体
      cell.font = Object.assign({}, cell.font || {}, { bold: true });

      // 添加淡色背景提升可读性
      cell.fill = Object.assign({}, cell.fill || {}, {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: fillColor },
      });

      // 显式设置细边框，避免依赖 Excel 网格线（不要隐藏边框）
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
      };
    }
  }
}

/**
 * 清理 Sheet 名称，使其满足 Excel 对工作表名称的限制
 *
 * - 去除非法字符（: \ / ? * [ ]）
 * - 保证非空（空则回退为 "Sheet1"）
 * - 限制长度不超过 31 个字符
 *
 * @param {string} name 原始名称
 * @returns {string} 处理后的合法 Sheet 名称
 */
function sanitizeSheetName(name) {
  let s = String(name || '').replace(/[:\\\/?*\[\]]/g, ' ');
  if (!s.trim()) {
    s = 'Sheet1';
  }
  if (s.length > 31) {
    s = s.slice(0, 31);
  }
  return s;
}

if (require.main === module) {
  main();
}
