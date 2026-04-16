const path = require('path');

/**
 * 解析结果校验
 *
 * 规则：
 * - 表级/行级一致性校验
 * - 字段级结构校验已由 parser 负责
 *
 * @param {{fields: string[], types: Record<string, string>, serverFlags: Record<string, string>, clientFlags: Record<string, string>, rows: Array<Record<string, any>>, fieldColumns?: Record<string, number>}} parsed
 * @param {{tableName: string, sheetName?: string}} tableMeta
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateParsedTable(parsed, tableMeta) {
  const errors = [];
  const warnings = [];
  const tableName = tableMeta?.tableName || 'UnknownTable';
  const sheetName = tableMeta?.sheetName || 'UnknownSheet';

  if (!parsed.rows || !parsed.rows.length) {
    errors.push(`[${tableName}/${sheetName}] 数据行为空，无法生成有效配置表`);
  }

  return { errors, warnings };
}

/**
 * 跨文件表名重复校验
 *
 * @param {{tables: Array<{tableName?: string, sheetName?: string}>, filePath: string, projectRoot: string, globalTableNameMap: Map<string, string>}} options
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateTableListGlobal(options) {
  const { tables, filePath, projectRoot, globalTableNameMap } = options || {};
  const errors = [];
  const warnings = [];
  if (!Array.isArray(tables) || tables.length === 0) {
    return { errors, warnings };
  }

  const tableMap = globalTableNameMap || new Map();
  tables.forEach((table) => {
    const tableName = table?.tableName;
    const sheetName = table?.sheetName || 'UnknownSheet';
    if (!tableName) {
      return;
    }
    const previousFile = tableMap.get(tableName);
    if (previousFile && previousFile !== filePath) {
      errors.push(
        `[${tableName}/${sheetName}] 表名重复，已在文件中定义: ${path.relative(projectRoot, previousFile)}`
      );
      return;
    }
    tableMap.set(tableName, filePath);
  });

  return { errors, warnings };
}

/**
 * 解析前单表校验
 *
 * @param {{table?: {tableName?: string, sheetName?: string}, workbook?: import('exceljs').Workbook}} options
 * @returns {{errors: string[], warnings: string[], sheet?: import('exceljs').Worksheet | null}}
 */
function validateTableMeta(options) {
  const { table, workbook } = options || {};
  const errors = [];
  const warnings = [];
  const tableName = table?.tableName || 'UnknownTable';
  const sheetName = table?.sheetName || 'UnknownSheet';

  if (!table?.tableName || !table?.sheetName) {
    errors.push(`[${tableName}/${sheetName}] 表配置缺少 SheetName 或 TableName`);
  }

  let sheet = null;
  if (workbook && table?.sheetName) {
    sheet = workbook.getWorksheet(table.sheetName) || null;
    if (!sheet) {
      errors.push(`[${tableName}/${sheetName}] Sheet 未找到`);
    }
  }

  return { errors, warnings, sheet };
}

/**
 * 解析前表集合校验
 *
 * @param {Array<{tableName?: string, sheetName?: string}>} tables
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateTableList(tables) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(tables) || tables.length === 0) {
    warnings.push('未找到任何配置表（meta 为空且无可用 Sheet）');
    return { errors, warnings };
  }

  const seenTableNames = new Set();
  tables.forEach((table) => {
    const tableName = table?.tableName;
    const sheetName = table?.sheetName || 'UnknownSheet';
    if (!tableName) {
      return;
    }
    if (seenTableNames.has(tableName)) {
      errors.push(`[${tableName}/${sheetName}] 表名重复: ${tableName}`);
      return;
    }
    seenTableNames.add(tableName);
  });

  return { errors, warnings };
}

module.exports = {
  validateParsedTable,
  validateTableMeta,
  validateTableList,
  validateTableListGlobal,
};
