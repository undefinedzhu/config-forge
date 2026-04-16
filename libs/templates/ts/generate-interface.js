/**
 * TypeScript 接口与索引生成器（语言相关）
 *
 * 输入：
 * - 表级元信息与字段描述（tableMeta / fields / types / scopeFlags / displayNames）
 * - 接口输出目录
 *
 * 输出：
 * - 单表接口代码字符串
 * - 接口目录下的 index.ts 聚合导出
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * 为指定接口目录生成 index.ts 统一导出文件
 *
 * @param {Array<{tableName: string, interfaceFileBaseName?: string}>} tables
 * @param {string} interfacesDir
 */
async function generateInterfacesIndexFile(tables, interfacesDir) {
  if (!tables || !tables.length) {
    return;
  }

  const sortedTables = [...tables].sort((a, b) => a.tableName.localeCompare(b.tableName));

  let indexContent = '// Auto-generated index file\n';
  indexContent += `// Generated at: ${new Date().toISOString()}\n`;
  indexContent += '// 表名来自 XLSX 配置表，无额外命名规范化处理\n\n';

  for (const { tableName, interfaceFileBaseName } of sortedTables) {
    const fileBase = interfaceFileBaseName || toKebabCase(tableName);
    indexContent += `export * from './${fileBase}.interface';\n`;
  }

  indexContent += '\n';
  indexContent += 'export const CONFIG_TABLES = {\n';

  for (const { tableName } of sortedTables) {
    indexContent += `  ${tableName}: '${tableName}',\n`;
  }

  indexContent += '} as const;\n\n';
  indexContent += 'export type ConfigTableName = keyof typeof CONFIG_TABLES;\n';

  const indexFile = path.join(interfacesDir, 'index.ts');
  await fs.writeFile(indexFile, indexContent);
}

/**
 * 当某个作用域下没有任何可见字段时，生成一个“空接口”占位文件
 */
function generateEmptyInterfaceCode(tableMeta, scope) {
  const { tableName, jsonFileName, primaryKey } = tableMeta;
  const interfaceName = `${tableName}Definition`;
  const metaConstName = `${tableName}Meta`;
  const baseName = (jsonFileName || '').endsWith('.json')
    ? jsonFileName.slice(0, -5)
    : jsonFileName || tableName;

  let code = `//  🔥 此文件由工具自动生成，请勿手动修改\n`;
  code += `// 生成时间: ${new Date().toISOString()}\n`;
  code += `// Scope: ${scope}\n`;
  code += '\n';

  code += `export interface ${interfaceName} {\n`;
  code += '  // 配置文件为空，请添加配置数据后重新生成\n';
  code += '}\n\n';

  code += `export const ${metaConstName} = {\n`;
  code += `  tableName: '${tableName}',\n`;
  code += `  dataFileName: '${baseName}.json',\n`;
  code += `  primaryKey: '${primaryKey || 'id'}',\n`;
  code += '  searchFields: [],\n';
  code += '  fieldsCount: 0,\n';
  code += '  isEmpty: true,\n';
  code += '} as const;\n\n';

  code += `export type ${tableName}ConfigMeta = typeof ${metaConstName};\n`;

  return code;
}

/**
 * 生成单张表在指定作用域下的接口定义与元数据
 *
 * @param {{ tableName: string, jsonFileName: string, primaryKey: string }} tableMeta 表级元信息
 * @param {string[]} fields 所有字段名
 * @param {Record<string, string>} types 字段类型声明
 * @param {Record<string, string>} scopeFlags server/client 标记
 * @param {'server' | 'client'} scope 目标作用域
 * @param {Record<string, string>} displayNames 字段显示名（第 1 行表头）
 */
function generateInterfaceCode(tableMeta, fields, types, scopeFlags, scope, displayNames = {}) {
  const { tableName, jsonFileName, primaryKey } = tableMeta;

  const interfaceName = `${tableName}Definition`;
  const metaConstName = `${tableName}Meta`;
  const metaTypeName = `${tableName}ConfigMeta`;

  const visibleFields = fields.filter((fieldName) => {
    const flag = scopeFlags[fieldName];
    return isFieldEnabledForScope(flag, scope);
  });

  if (!visibleFields.length) {
    return generateEmptyInterfaceCode(tableMeta, scope);
  }

  const baseName = (jsonFileName || '').endsWith('.json')
    ? jsonFileName.slice(0, -5)
    : jsonFileName || tableName;

  let code = `// 🔥 此文件由工具自动生成，请勿手动修改\n`;
  code += `// 生成时间: ${new Date().toISOString()}\n`;
  code += '// 字段名来自 XLSX 配置表\n';
  code += `// Scope: ${scope}\n`;
  code += '\n';

  code += `export interface ${interfaceName} {\n`;

  for (const fieldName of visibleFields) {
    const tsType = mapTypeToTs(types[fieldName]);
    const rawDisplayName = displayNames[fieldName];
    const cleanedDisplayName =
      typeof rawDisplayName === 'string' ? rawDisplayName.replace(/[\r\n]+/g, ' ').trim() : '';
    const comment = cleanedDisplayName ? ` // ${cleanedDisplayName}` : '';
    code += `  ${fieldName}: ${tsType};${comment}\n`;
  }

  code += '}\n\n';

  const searchFields = findSearchFieldsFromXlsx(visibleFields, types);

  code += `export const ${metaConstName} = {\n`;
  code += `  tableName: '${tableName}',\n`;
  code += `  dataFileName: '${baseName}.json',\n`;
  code += `  primaryKey: '${primaryKey}',\n`;
  code += `  searchFields: [${searchFields.map((f) => `'${f}'`).join(', ')}],\n`;
  code += `  fieldsCount: ${visibleFields.length},\n`;
  code += `  requiredFields: [${visibleFields.map((f) => `'${f}'`).join(', ')}],\n`;
  code += '  optionalFields: [],\n';
  code += '} as const;\n\n';

  code += `export type ${metaTypeName} = typeof ${metaConstName};\n`;

  return code;
}

/**
 * 将表名转换为 kebab-case，用于生成文件名
 */
function toKebabCase(str) {
  if (!str) return '';
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * 从 XLSX 字段中推断可作为搜索字段的字段名
 */
function findSearchFieldsFromXlsx(fields, types) {
  const searchablePatterns = ['name', 'title', 'description', 'desc', 'info'];

  return fields
    .filter((fieldName) => {
      const tsType = mapTypeToTs(types[fieldName]);
      if (tsType !== 'string') {
        return false;
      }

      const lowerName = fieldName.toLowerCase();
      return searchablePatterns.some((pattern) => lowerName.includes(pattern));
    })
    .map((fieldName) => fieldName);
}

/**
 * 将配置中的类型标记映射为 TypeScript 类型
 */
function mapTypeToTs(typeName) {
  const t = (typeName || 'string').toLowerCase();

  if (t.endsWith('[]')) {
    const base = t.slice(0, -2).trim();
    return `${mapTypeToTs(base)}[]`;
  }

  if (t === 'int' || t === 'integer' || t === 'float' || t === 'double') {
    return 'number';
  }

  if (t === 'bool' || t === 'boolean') {
    return 'boolean';
  }

  if (t === 'date' || t === 'datetime') {
    return 'string';
  }

  if (t === 'json' || t === 'object') {
    return 'Record<string, unknown>';
  }

  if (t === 'string') {
    return 'string';
  }

  return 'unknown';
}

/**
 * 判断字段在特定作用域（server / client）是否启用
 */
function isFieldEnabledForScope(flagRaw, scope) {
  const flag = (flagRaw || '').toLowerCase();

  if (scope === 'server') {
    return flag === 'server' || flag === 's' || flag === '1';
  }

  if (scope === 'client') {
    return flag === 'client' || flag === 'c' || flag === '1';
  }

  return false;
}

module.exports = {
  generateInterfacesIndexFile,
  generateInterfaceCode,
  toKebabCase,
};
