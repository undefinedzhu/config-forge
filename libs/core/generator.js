/**
 * 通用数据生成器（语言无关）
 *
 * 输入：
 * - 解析后的表数据（rows/fields/types/scopeFlags）
 * - 目标作用域（server/client）
 *
 * 输出：
 * - 作用域裁剪后的 JSON 数据结构
 */

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
 * 按 server / client 作用域过滤字段并构建 JSON 数据
 */
function buildScopedJson(rows, fields, types, scopeFlags, scope) {
  const result = [];

  for (const row of rows) {
    const obj = {};

    for (const fieldName of fields) {
      const flag = scopeFlags[fieldName];
      if (!isFieldEnabledForScope(flag, scope)) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(row, fieldName)) {
        obj[fieldName] = row[fieldName];
      }
    }

    result.push(obj);
  }

  return result;
}

module.exports = {
  buildScopedJson,
};
