/**
 * C# 配置模板生成器
 *
 * 输入：
 * - XLSX 转换后的表描述（table descriptors）
 * - 输出目录（默认 output/client-csharp）
 * - 命名空间（默认 ConfigForge.Generated）
 *
 * 输出：
 * - 每张表一个 C# 模型类
 * - ConfigTableNames 常量集合
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * 生成 C# 模板
 *
 * @param {Array} tables
 * @param {{outputRoot?: string, namespaceName?: string}} options
 */
async function generateCSharpTemplates(tables, options = {}) {
  const outputRoot = options.outputRoot || path.join(process.cwd(), 'output', 'client-csharp');
  const namespaceName = options.namespaceName || 'ConfigForge.Generated';

  if (!Array.isArray(tables) || tables.length === 0) {
    return;
  }

  await fs.ensureDir(outputRoot);

  const sortedTables = [...tables].sort((a, b) => a.tableName.localeCompare(b.tableName));

  for (const table of sortedTables) {
    const classCode = buildCSharpClass(table, namespaceName);
    const filePath = path.join(outputRoot, `${table.tableName}.cs`);
    await fs.writeFile(filePath, classCode, 'utf-8');
  }

  const namesCode = buildTableNames(sortedTables, namespaceName);
  await fs.writeFile(path.join(outputRoot, 'ConfigTableNames.cs'), namesCode, 'utf-8');
}

/**
 * 构建 C# 模型类代码
 */
function buildCSharpClass(table, namespaceName) {
  const fields = Array.isArray(table.fields) ? table.fields : [];
  const types = table.types || {};
  const displayNames = table.displayNames || {};
  const scope = table.scope || 'client';
  const scopeFlags = scope === 'server' ? table.serverFlags || {} : table.clientFlags || {};

  const visibleFields = fields.filter((fieldName) => isFieldEnabledForScope(scopeFlags[fieldName], scope));
  const searchFields = findSearchFields(visibleFields, types);

  const usingLines = [
    'using System;',
    'using System.Collections.Generic;',
  ];
  if (hasJsonField(visibleFields, types)) {
    usingLines.push('using System.Text.Json;');
  }

  let code = `${usingLines.join('\n')}\n\n`;
  code += `namespace ${namespaceName}\n{\n`;
  code += `  /// <summary>\n`;
  code += `  /// ${table.tableName} 配置表模型\n`;
  code += `  /// 自动生成，请勿手动修改\n`;
  code += `  /// </summary>\n`;
  code += `  public class ${table.tableName}\n  {\n`;
  code += `    public static readonly string TableName = "${table.tableName}";\n`;
  code += `    public static readonly string JsonFileName = "${table.jsonFileName || `${table.tableName}.json`}";\n`;
  code += `    public static readonly string PrimaryKey = "${table.primaryKey || 'id'}";\n`;
  const searchFieldsLiteral = searchFields.length
    ? `new[] { ${searchFields.map((f) => `"${f}"`).join(', ')} }`
    : 'Array.Empty<string>()';
  code += `    public static readonly string[] SearchFields = ${searchFieldsLiteral};\n\n`;

  for (const fieldName of visibleFields) {
    const csharpType = mapTypeToCSharp(types[fieldName]);
    const displayName = displayNames[fieldName];
    const cleanedDisplayName =
      typeof displayName === 'string' ? displayName.replace(/[\r\n]+/g, ' ').trim() : '';

    if (cleanedDisplayName) {
      code += `    /// <summary>\n`;
      code += `    /// ${cleanedDisplayName}\n`;
      code += `    /// </summary>\n`;
    }

    code += `    public ${csharpType} ${toPascalCase(fieldName)} { get; set; }\n\n`;
  }

  code += '  }\n';
  code += '}\n';

  return code;
}

/**
 * 生成配置表名常量
 */
function buildTableNames(tables, namespaceName) {
  let code = `namespace ${namespaceName}\n{\n`;
  code += '  /// <summary>\n';
  code += '  /// 配置表名称常量\n';
  code += '  /// 自动生成，请勿手动修改\n';
  code += '  /// </summary>\n';
  code += '  public static class ConfigTableNames\n  {\n';

  for (const table of tables) {
    code += `    public const string ${toPascalCase(table.tableName)} = "${table.tableName}";\n`;
  }

  code += '  }\n';
  code += '}\n';

  return code;
}

/**
 * 将配置中的类型标记映射为 C# 类型
 */
function mapTypeToCSharp(typeName) {
  const t = (typeName || 'string').toLowerCase();

  if (t.endsWith('[]')) {
    const base = t.slice(0, -2).trim();
    return `List<${mapTypeToCSharp(base)}>`;
  }

  if (t === 'int' || t === 'integer') {
    return 'int';
  }

  if (t === 'float') {
    return 'float';
  }

  if (t === 'double') {
    return 'double';
  }

  if (t === 'bool' || t === 'boolean') {
    return 'bool';
  }

  if (t === 'date' || t === 'datetime') {
    return 'string';
  }

  if (t === 'json' || t === 'object') {
    return 'JsonElement';
  }

  return 'string';
}

function findSearchFields(fields, types) {
  const searchablePatterns = ['name', 'title', 'description', 'desc', 'info'];
  return fields.filter((fieldName) => {
    const t = (types[fieldName] || 'string').toLowerCase();
    if (t.endsWith('[]')) {
      return false;
    }
    if (t !== 'string') {
      return false;
    }
    const lower = fieldName.toLowerCase();
    return searchablePatterns.some((pattern) => lower.includes(pattern));
  });
}

function hasJsonField(fields, types) {
  return fields.some((fieldName) => {
    const t = (types[fieldName] || 'string').toLowerCase();
    const baseType = t.endsWith('[]') ? t.slice(0, -2).trim() : t;
    return baseType === 'json' || baseType === 'object';
  });
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

/**
 * 将字段名转换为 PascalCase
 */
function toPascalCase(text) {
  if (!text) return '';
  return String(text)
    .replace(/[_\s-]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (m) => m.toUpperCase());
}

module.exports = {
  generateCSharpTemplates,
};
