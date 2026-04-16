const path = require('path');
const { columnNumberToName, validateFieldMeta } = require('./field-guard');

/**
 * 解析 __meta__ Sheet 中的表配置
 *
 * 期望结构：
 *   - 第 1 行为表头，包含 SheetName / TableName / JsonFileName / PrimaryKey 等列
 *   - 第 2 行起为数据行
 *
 * @param {import('exceljs').Workbook} workbook
 * @returns {Array<{sheetName: string, tableName: string, jsonFileName: string, primaryKey: string | null}>}
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

  const result = [];

  for (let r = 2; r <= metaSheet.rowCount; r++) {
    const row = metaSheet.getRow(r);
    const sheetName = getCellString(row, headers['SheetName']);
    if (!sheetName) continue;

    const tableName = getCellString(row, headers['TableName']) || sheetName;
    const jsonFileName = getCellString(row, headers['JsonFileName']) || `${tableName}.json`;

    let primaryKey = '';
    if (headers['PrimaryKey']) {
      primaryKey = getCellString(row, headers['PrimaryKey']);
    }

    result.push({ sheetName, tableName, jsonFileName, primaryKey: primaryKey || null });
  }

  return result;
}

/**
 * 当未提供 __meta__ Sheet 时，退化为按 Sheet 名推断元信息
 *
 * 约定：
 *   - 表名 = Sheet 名
 *   - JSON 文件名 = {表名}.json
 *
 * @param {import('exceljs').Workbook} workbook
 */
function inferMetaFromSheets(workbook) {
  const result = [];

  workbook.worksheets.forEach((sheet) => {
    if (!sheet || sheet.name === '__meta__') {
      return;
    }

    const sheetName = sheet.name;
    const tableName = sheetName;
    const jsonFileName = `${tableName}.json`;

    result.push({ sheetName, tableName, jsonFileName, primaryKey: null });
  });

  return result;
}

/**
 * 解析单个配置 Sheet 的表头和数据
 *
 * 结构约定：
 *   - 第 1 行：显示名（用于生成字段注释）
 *   - 第 2 行：字段名
 *   - 第 3 行：类型（int / float / string / bool / json 等）
 *   - 第 4 行：server 端使用标记
 *   - 第 5 行：client 端使用标记
 *   - 第 6 行起：数据行
 *
 * @param {import('exceljs').Worksheet} sheet
 * @returns {{
 *   fields: string[],
 *   types: Record<string, string>,
 *   serverFlags: Record<string, string>,
 *   clientFlags: Record<string, string>,
 *   rows: Array<Record<string, any>>,
 *   displayNames: Record<string, string>,
 *   fieldColumns: Record<string, number>,
 *   warnings: string[],
 * } | null}
 */
function parseConfigSheet(sheet) {
  const displayRow = sheet.getRow(1);
  const headerRowField = sheet.getRow(2);
  if (!headerRowField || headerRowField.cellCount === 0) {
    return null;
  }

  const headerRowType = sheet.getRow(3); // 类型行
  const headerRowServerFlag = sheet.getRow(4); // server 标记行
  const headerRowClientFlag = sheet.getRow(5); // client 标记行
  const dataStartRow = 6; // 数据起始行
  const columnCount = Math.max(
    headerRowField.cellCount || 0,
    displayRow?.cellCount || 0,
    headerRowType?.cellCount || 0,
    headerRowServerFlag?.cellCount || 0,
    headerRowClientFlag?.cellCount || 0,
    sheet.columnCount || 0
  );

  const fields = []; // 字段名列表
  const types = {}; // 字段类型映射
  const serverFlags = {}; // server 端字段标记映射
  const clientFlags = {}; // client 端字段标记映射
  const displayNames = {}; // 字段显示名映射
  const fieldColumnIndexes = {}; // 字段 -> 列号映射
  const warnings = []; // 解析阶段告警信息
  const seenFields = new Set(); // 已出现字段名集合

  for (let c = 1; c <= columnCount; c++) {
    const fieldName = getCellString(headerRowField, c);
    if (!fieldName) {
      const displayName = getCellString(displayRow, c);
      const typeName = getCellString(headerRowType, c);
      const serverFlag = getCellString(headerRowServerFlag, c);
      const clientFlag = getCellString(headerRowClientFlag, c);
      const hasHeaderInfo = displayName || typeName || serverFlag || clientFlag;
      let hasData = false;

      if (!hasHeaderInfo) {
        for (let r = dataStartRow; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r);
          const cell = row.getCell(c);
          const rawValue = cell && cell.value !== undefined ? cell.value : null;
          if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
            hasData = true;
            break;
          }
        }
      }

      if (hasHeaderInfo || hasData) {
        const columnLabel = columnNumberToName(c);
        const reason = hasData ? '存在数据但缺少字段名' : '列表头不完整，缺少字段名';
        warnings.push(`[${columnLabel}] ${reason}，已忽略该列`);
      }
      continue;
    }

    const typeNameRaw = getCellString(headerRowType, c) || 'string';
    const serverFlag = getCellString(headerRowServerFlag, c);
    const clientFlag = getCellString(headerRowClientFlag, c);
    const validation = validateFieldMeta({
      fieldName,
      columnIndex: c,
      typeNameRaw,
      serverFlag,
      clientFlag,
      seenFields,
    });
    if (!validation.ok) {
      warnings.push(...validation.warnings);
      continue;
    }

    fields.push(fieldName);
    seenFields.add(fieldName);
    fieldColumnIndexes[fieldName] = c;
    types[fieldName] = typeNameRaw;
    serverFlags[fieldName] = serverFlag;
    clientFlags[fieldName] = clientFlag;

    if (displayRow) {
      const displayName = getCellString(displayRow, c);
      if (displayName) {
        displayNames[fieldName] = displayName;
      }
    }
  }

  if (!fields.length) {
    return null;
  }

  const rows = [];

  for (let r = 6; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row || row.cellCount === 0) {
      continue;
    }

    const record = {};
    let hasValue = false;

    for (const fieldName of fields) {
      const colIndex = fieldColumnIndexes[fieldName];
      if (!colIndex) {
        continue;
      }

      const cell = row.getCell(colIndex);
      const rawValue = cell.value;
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        continue;
      }

      const parsed = parseValueByType(rawValue, types[fieldName]);
      record[fieldName] = parsed;
      hasValue = true;
    }

    if (hasValue) {
      rows.push(record);
    }
  }

  return {
    fields,
    types,
    serverFlags,
    clientFlags,
    rows,
    displayNames,
    fieldColumns: fieldColumnIndexes,
    warnings,
  };
}

/**
 * 从表头显示名中检测主键字段
 *
 * 规则：
 *   - 扫描第 1 行显示名，查找包含 [PK] 或 【PK】 的单元格
 *   - 命中后，取对应第 2 行字段名作为主键
 *
 * @param {import('exceljs').Worksheet} sheet
 */
function detectPrimaryKeyFromHeader(sheet) {
  const displayRow = sheet.getRow(1);
  const fieldRow = sheet.getRow(2);
  if (!displayRow || !fieldRow) {
    return null;
  }

  const columnCount = sheet.columnCount || fieldRow.cellCount;
  const pkRegex = /\[pk\]|【pk】/i;

  for (let c = 1; c <= columnCount; c++) {
    const displayText = getCellString(displayRow, c);
    if (!displayText) continue;
    if (!pkRegex.test(displayText)) continue;

    const fieldName = getCellString(fieldRow, c);
    if (fieldName) {
      return fieldName;
    }
  }

  return null;
}

/**
 * 在第 2 行表头中查找字段名对应的列号
 */
function findColumnIndexByFieldName(sheet, fieldName, headerRowField, columnCount) {
  for (let c = 1; c <= columnCount; c++) {
    const name = getCellString(headerRowField, c);
    if (name === fieldName) {
      return c;
    }
  }
  return null;
}

/**
 * 将单元格内容统一转换为字符串
 *
 * 兼容：普通值 / 富文本 / exceljs 的 value.text 等格式
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
 * 根据配置声明的类型解析单元格值
 *
 * 支持基础类型、数组类型（以逗号分隔）等
 */
function parseValueByType(rawValue, typeName) {
  const t = (typeName || 'string').toLowerCase();

  if (t.endsWith('[]')) {
    const baseType = t.slice(0, -2).trim();
    const text = valueToString(rawValue);
    if (!text) return [];

    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.map((p) => parseSingleValue(p, baseType));
  }

  return parseSingleValue(rawValue, t);
}

/**
 * 解析单个值为指定基本类型
 */
function parseSingleValue(rawValue, baseType) {
  const t = (baseType || 'string').toLowerCase();

  if (t === 'int' || t === 'integer') {
    const n = Number(valueToString(rawValue));
    return Number.isNaN(n) ? null : Math.trunc(n);
  }

  if (t === 'float' || t === 'double') {
    const n = Number(valueToString(rawValue));
    return Number.isNaN(n) ? null : n;
  }

  if (t === 'bool' || t === 'boolean') {
    const s = valueToString(rawValue).toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return true;
    if (s === '0' || s === 'false' || s === 'no') return false;
    return null;
  }

  if (t === 'date' || t === 'datetime') {
    return valueToString(rawValue);
  }

  if (t === 'json' || t === 'object') {
    const text = valueToString(rawValue);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return valueToString(rawValue);
}

/**
 * 将任意单元格值转换为字符串（去掉多余空白）
 */
function valueToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v.text) return String(v.text).trim();
  if (v.richText) return v.richText.map((t) => t.text).join('').trim();
  return String(v).trim();
}

module.exports = {
  readMetaSheet,
  inferMetaFromSheets,
  parseConfigSheet,
  detectPrimaryKeyFromHeader,
};
