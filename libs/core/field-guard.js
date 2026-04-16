// 字段级结构校验与列号工具

const flagAllowed = new Set(['', '-', 'server', 'client', 's', 'c', '1']);
const typeAllowed = new Set([
  'int',
  'integer',
  'float',
  'double',
  'string',
  'bool',
  'boolean',
  'date',
  'datetime',
  'json',
  'object',
]);

// 将列号转换为字母标识（如 1->A）
function columnNumberToName(columnNumber) {
  let n = columnNumber;
  let result = '';

  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result || '未知列';
}

// 校验字段元信息，返回是否可用及警告
function validateFieldMeta(options) {
  const { fieldName, columnIndex, typeNameRaw, serverFlag, clientFlag, seenFields } = options;
  const warnings = [];
  const columnLabel = columnNumberToName(columnIndex);

  if (!/^[a-zA-Z0-9_]+$/.test(fieldName)) {
    warnings.push(`[${columnLabel}] 字段名包含非法字符: ${fieldName}，已忽略该列`);
    return { ok: false, warnings };
  }

  if (seenFields && seenFields.has(fieldName)) {
    warnings.push(`[${columnLabel}] 字段名重复: ${fieldName}，已忽略该列`);
    return { ok: false, warnings };
  }

  const typeBase = typeNameRaw.endsWith('[]') ? typeNameRaw.slice(0, -2).trim() : typeNameRaw;
  if (typeBase && !typeAllowed.has(typeBase.toLowerCase())) {
    warnings.push(`[${columnLabel}] 字段 ${fieldName} 的类型未在允许范围内: ${typeNameRaw}，已忽略该列`);
    return { ok: false, warnings };
  }

  const normalizedServerFlag = String(serverFlag || '').trim().toLowerCase();
  const normalizedClientFlag = String(clientFlag || '').trim().toLowerCase();
  if (!flagAllowed.has(normalizedServerFlag)) {
    warnings.push(
      `[${columnLabel}] 字段 ${fieldName} 的 server 标记不在允许范围内: ${serverFlag || '(空)'}，已忽略该列`
    );
    return { ok: false, warnings };
  }
  if (!flagAllowed.has(normalizedClientFlag)) {
    warnings.push(
      `[${columnLabel}] 字段 ${fieldName} 的 client 标记不在允许范围内: ${clientFlag || '(空)'}，已忽略该列`
    );
    return { ok: false, warnings };
  }

  return { ok: true, warnings: [] };
}

module.exports = {
  columnNumberToName,
  validateFieldMeta,
};
