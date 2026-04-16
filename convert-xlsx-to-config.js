#!/usr/bin/env node

/**
 * XLSX → JSON & Interface & Facade 等辅助开发代码转换工具
 *
 * 基于 config-spreadsheet-spec 规范：
 *   - 以 XLSX 为唯一配置源（包含多个配置 Sheet + 一个 __meta__ Sheet）
 *   - 每个配置 Sheet 使用 5 行表头（显示名 / 字段名 / 类型 / server / client）+ 数据
 *   - __meta__ Sheet 记录每张表的 SheetName / TableName / JsonFileName / PrimaryKey / Description
 *
 * 默认输出到项目根目录下的 output 目录，方便调试和后续接入：
 *   - JSON：output/{server,client}/json/
 *   - interface：output/{server,client}/interfaces/
 *
 * 使用示例（在项目根目录）：
 *   # 默认从 input/xlsx 读取所有 .xlsx
 *   node convert-xlsx-to-config.js
 *
 *   # 指定输入目录或单个文件
 *   node convert-xlsx-to-config.js --input input/xlsx
 *   node convert-xlsx-to-config.js --input some-configs.xlsx
 *
 *   # 只生成 server 或 client
 *   node convert-xlsx-to-config.js --target server
 *   node convert-xlsx-to-config.js --target client
 */

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const {
  readMetaSheet,
  inferMetaFromSheets,
  parseConfigSheet,
  detectPrimaryKeyFromHeader,
} = require('./libs/core/parser');
const { buildScopedJson } = require('./libs/core/generator');
const {
  generateInterfacesIndexFile,
  generateInterfaceCode,
  toKebabCase,
} = require('./libs/templates/ts/generate-interface');
const { resolveXlsxFiles } = require('./libs/core/io');
const {
  validateParsedTable,
  validateTableList,
  validateTableListGlobal,
  validateTableMeta,
} = require('./libs/core/validator');
const { CACHE_VERSION, loadCache, saveCache, computeFileHash, buildCacheKey } = require('./libs/core/cache');
const { createDefaultGeneratorPlugins, runGeneratorPlugins } = require('./libs/generator-plugins');

// 统一将工作目录切到项目根目录
process.chdir(path.resolve(__dirname));

/**
 * CLI 入口函数
 *
 * 整体流程:
 * 1. 解析命令行参数，解析输入路径 / 输出目录 / 目标端 (server | client | both)
 * 2. 扫描 XLSX 文件列表
 * 3. 对每个 XLSX:
 *    - 读取 __meta__ Sheet 或按 Sheet 名推断表信息
 *    - 按配置规范解析 5 行表头 + 数据行
 *    - 按 server / client 作用域分别生成 JSON 与 TS interface
 * 4. 基于生成的表描述，生成 server / client 侧的配套模板代码
 */
async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const projectRoot = process.cwd();
    const errorSummary = new Map();
    const warningSummary = new Map();

    const pushSummaryError = (filePath, message) => {
      if (!errorSummary.has(filePath)) {
        errorSummary.set(filePath, []);
      }
      errorSummary.get(filePath).push(message);
    };

    const pushSummaryWarning = (filePath, message) => {
      if (!warningSummary.has(filePath)) {
        warningSummary.set(filePath, []);
      }
      warningSummary.get(filePath).push(message);
    };

    const normalizedLanguages = normalizeLanguages(args.languages);
    args.languages = normalizedLanguages.split(',');

    const inputPath = path.resolve(projectRoot, args.input);
    const outRoot = path.resolve(projectRoot, args.outDir);

    const jsonServerDir = path.join(outRoot, 'server', 'json');
    const jsonClientDir = path.join(outRoot, 'client', 'json');
    const interfaceServerDir = path.join(outRoot, 'server', 'interfaces');
    const interfaceClientDir = path.join(outRoot, 'client', 'interfaces');

    const cachePath = path.join(outRoot, '.cache.json');
    const cache = await loadCache(cachePath);

    const shouldClearCache =
      args.cacheClear ||
      cache.version !== CACHE_VERSION ||
      cache.meta.jsonSpaces !== args.jsonSpaces ||
      cache.meta.target !== args.target ||
      cache.meta.languages !== normalizedLanguages;
    if (shouldClearCache) {
      cache.files = {};
    }
    cache.meta = {
      jsonSpaces: args.jsonSpaces,
      target: args.target,
      languages: normalizedLanguages,
    };

    await fs.ensureDir(outRoot);
    await fs.ensureDir(jsonServerDir);
    await fs.ensureDir(jsonClientDir);
    await fs.ensureDir(interfaceServerDir);
    await fs.ensureDir(interfaceClientDir);

    console.log(chalk.blue.bold('📥 XLSX → JSON & Interface 导入工具'));
    console.log(chalk.gray('基于 config-spreadsheet-spec 规范，从 XLSX 生成 server/client JSON 和 TS interface\n'));

    console.log(chalk.cyan(`📂 项目根目录: ${projectRoot}`));
    console.log(chalk.cyan(`📥 输入路径: ${inputPath}`));
    console.log(chalk.cyan(`📁 输出根目录: ${outRoot}`));
    console.log(chalk.cyan(`🎯 生成目标: ${args.target}`));
    console.log(chalk.cyan(`🧾 JSON 格式: ${args.jsonSpaces === 0 ? 'minify' : `pretty(${args.jsonSpaces} spaces)`}`));
    console.log(chalk.cyan(`🧩 生成语言: ${args.languages.join(', ')}`));
    console.log(chalk.cyan(`🧪 严格校验: ${args.strict ? '开启' : '关闭'}`));
    console.log(chalk.cyan(`🧪 预览模式: ${args.dryRun ? '开启' : '关闭'}`));
    console.log(chalk.cyan(`🧹 清空缓存: ${args.cacheClear ? '开启' : '关闭'}`));
    console.log(chalk.cyan(`🧯 插件失败退出: ${args.failOnPluginError ? '开启' : '关闭'}`));
    if (args.csharpNamespace) {
      console.log(chalk.cyan(`🧭 C# 命名空间: ${args.csharpNamespace}`));
    }

    let ExcelJS;
    try {
      ExcelJS = require('exceljs');
    } catch (err) {
      console.error(chalk.red('❌ 需要 exceljs 依赖才能读取 XLSX。'));
      console.error(chalk.yellow('   请先运行: npm install exceljs --save-dev'));
      process.exit(1);
    }

    const xlsxFiles = await resolveXlsxFiles(inputPath);

    if (!xlsxFiles.length) {
      console.log(chalk.yellow('⚠️ 未找到任何 .xlsx 文件，请检查输入路径或先导出配置。'));
      return;
    }

    console.log(chalk.cyan(`🔍 找到 ${xlsxFiles.length} 个 XLSX 文件`));

    let totalTables = 0;
    let cachedFiles = 0;
    const serverTableDescriptors = [];
    const clientTableDescriptors = [];
    let dryRunGeneratedTables = 0;
    const strictErrors = [];
    const globalTableNameMap = new Map();

    for (const file of xlsxFiles) {
      console.log(chalk.blue(`\n➡  处理: ${path.relative(projectRoot, file)}`));

      const cacheKey = buildCacheKey(file, projectRoot, {
        target: args.target,
        jsonSpaces: args.jsonSpaces,
        languages: args.languages,
      });
      let fileHash = '';
      try {
        fileHash = await computeFileHash(file);
      } catch (err) {
        console.error(chalk.red(`  ❌ 读取文件失败，无法计算哈希: ${file}`));
        console.error(chalk.red(`     ${err.message}`));
        pushSummaryError(file, `读取文件失败，无法计算哈希: ${err.message}`);
        continue;
      }

      const cachedEntry = cache.files[cacheKey];
      const cachedTables = cachedEntry && Array.isArray(cachedEntry.clientTables)
        ? cachedEntry.clientTables
        : [];
      const hasFieldDetail = cachedTables.some((table) =>
        Array.isArray(table.fields) && table.fields.length > 0
      );
      if (
        cachedEntry &&
        cachedEntry.hash === fileHash &&
        Array.isArray(cachedEntry.serverTables) &&
        Array.isArray(cachedEntry.clientTables) &&
        hasFieldDetail
      ) {
        cachedFiles += 1;
        totalTables += cachedEntry.tableCount || 0;

        if (args.target === 'server' || args.target === 'both') {
          serverTableDescriptors.push(...cachedEntry.serverTables);
        }
        if (args.target === 'client' || args.target === 'both') {
          clientTableDescriptors.push(...cachedEntry.clientTables);
        }

        console.log(chalk.gray(`  ⏭ 未变更，跳过生成（缓存命中: ${cacheKey}）`));
        continue;
      }

      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file);

        const metaMap = readMetaSheet(workbook);

        // 如无 __meta__，退化为根据 Sheet 自行推断
        const tables = metaMap.length ? metaMap : inferMetaFromSheets(workbook);

        const preTablesValidation = validateTableList(tables);
        if (preTablesValidation.warnings.length) {
          preTablesValidation.warnings.forEach((msg) => console.log(chalk.yellow(`  ⚠️ ${msg}`)));
        }
        if (preTablesValidation.errors.length) {
          preTablesValidation.errors.forEach((msg) => console.log(chalk.red(`  ❌ ${msg}`)));
          continue;
        }
        if (!tables.length) {
          continue;
        }

        const globalValidation = validateTableListGlobal({
          tables,
          filePath: file,
          projectRoot,
          globalTableNameMap,
        });
        if (globalValidation.errors.length) {
          globalValidation.errors.forEach((msg) => {
            console.log(chalk.red(`  ❌ ${msg}`));
            pushSummaryError(file, msg);
          });
          if (args.strict) {
            strictErrors.push(...globalValidation.errors);
          }
        }

        const serverTablesInFile = [];
        const clientTablesInFile = [];

        for (const table of tables) {
          const preTableValidation = validateTableMeta({ table, workbook });
          if (preTableValidation.errors.length) {
            preTableValidation.errors.forEach((msg) => {
              console.log(chalk.yellow(`  ⚠️ ${msg}`));
              pushSummaryError(file, msg);
            });
            continue;
          }
          const sheet = preTableValidation.sheet;
          if (!sheet) {
            continue;
          }

          // 按优先级确定主键：__meta__.PrimaryKey > 表头行1中的 [PK]/【PK】 标记 > 默认 id
          let effectivePrimaryKey = table.primaryKey;
          if (!effectivePrimaryKey) {
            effectivePrimaryKey = detectPrimaryKeyFromHeader(sheet) || 'id';
          }

          const parsed = parseConfigSheet(sheet);
          if (!parsed) {
            console.log(chalk.yellow('    ⚠️ 表头或数据解析失败，已跳过'));
            pushSummaryError(file, `[${table.tableName}/${table.sheetName}] 表头或数据解析失败`);
            continue;
          }

          if (Array.isArray(parsed.warnings) && parsed.warnings.length) {
            parsed.warnings.forEach((msg) => {
              const formatted = `[${table.tableName}/${table.sheetName}] ${msg}`;
              console.log(chalk.yellow(`    ⚠️ ${formatted}`));
              pushSummaryWarning(file, formatted);
            });
          }

          const validation = validateParsedTable(parsed, table);
          if (validation.errors.length) {
            validation.errors.forEach((msg) => console.log(chalk.red(`    ❌ ${msg}`)));
            validation.errors.forEach((msg) => {
              pushSummaryError(file, msg);
            });
            if (args.strict) {
              strictErrors.push(...validation.errors);
            }
            continue;
          }
          if (validation.warnings.length) {
            validation.warnings.forEach((msg) => {
              console.log(chalk.yellow(`    ⚠️ ${msg}`));
              pushSummaryWarning(file, msg);
            });
          }

          const { fields, types, serverFlags, clientFlags, rows, displayNames } = parsed;
          const tableMetaWithPk = { ...table, primaryKey: effectivePrimaryKey };
          const interfaceFileBaseName = toKebabCase(table.tableName);

          // 生成 server/client JSON
          const tableDescriptorBase = {
            tableName: table.tableName,
            jsonFileName: table.jsonFileName,
            primaryKey: effectivePrimaryKey,
            interfaceName: `${table.tableName}Definition`,
            interfaceFileBaseName,
            fields,
            types,
            serverFlags,
            clientFlags,
            displayNames,
          };

          const serverDescriptor = { ...tableDescriptorBase, scope: 'server' };
          const clientDescriptor = { ...tableDescriptorBase, scope: 'client' };
          serverTablesInFile.push(serverDescriptor);
          clientTablesInFile.push(clientDescriptor);

          if (args.target === 'server' || args.target === 'both') {
            const serverJson = buildScopedJson(rows, fields, types, serverFlags, 'server');
            const serverPath = path.join(jsonServerDir, table.jsonFileName);
            if (!args.dryRun) {
              await fs.writeJson(serverPath, serverJson, { spaces: args.jsonSpaces });
            }
            console.log(chalk.green(`    ✅ server JSON (${table.tableName})`));

            const serverInterfaceCode = generateInterfaceCode(
              tableMetaWithPk,
              fields,
              types,
              serverFlags,
              'server',
              displayNames
            );
            const serverInterfaceFile = path.join(interfaceServerDir, `${interfaceFileBaseName}.interface.ts`);
            if (!args.dryRun) {
              await fs.writeFile(serverInterfaceFile, serverInterfaceCode, 'utf-8');
            }
            console.log(chalk.green(`    ✅ server interface (${table.tableName})`));

            serverTableDescriptors.push(serverDescriptor);
          }

          if (args.target === 'client' || args.target === 'both') {
            const clientJson = buildScopedJson(rows, fields, types, clientFlags, 'client');
            const clientPath = path.join(jsonClientDir, table.jsonFileName);
            if (!args.dryRun) {
              await fs.writeJson(clientPath, clientJson, { spaces: args.jsonSpaces });
            }
            console.log(chalk.green(`    ✅ client JSON (${table.tableName})`));

            const clientInterfaceCode = generateInterfaceCode(
              tableMetaWithPk,
              fields,
              types,
              clientFlags,
              'client',
              displayNames
            );
            const clientInterfaceFile = path.join(interfaceClientDir, `${interfaceFileBaseName}.interface.ts`);
            if (!args.dryRun) {
              await fs.writeFile(clientInterfaceFile, clientInterfaceCode, 'utf-8');
            }
            console.log(chalk.green(`    ✅ client interface (${table.tableName})`));

            clientTableDescriptors.push(clientDescriptor);
          }

          totalTables++;
          dryRunGeneratedTables++;
        }

        cache.files[cacheKey] = {
          hash: fileHash,
          serverTables: serverTablesInFile,
          clientTables: clientTablesInFile,
          tableCount: tables.length,
        };
      } catch (err) {
        console.error(chalk.red('  ❌ 处理 XLSX 失败'), err.message || err);
        const message = err && err.message ? err.message : String(err);
        pushSummaryError(file, `处理 XLSX 失败: ${message}`);
        if (args.strict) {
          strictErrors.push(`XLSX 处理失败: ${message}`);
        }
      }
    }

    if (args.strict && strictErrors.length) {
      console.log(chalk.red(`\n❌ 严格校验失败，总计错误: ${strictErrors.length}`));
      strictErrors.forEach((msg) => console.log(chalk.red(`   - ${msg}`)));
      process.exit(1);
    }

    if (!args.dryRun) {
      await saveCache(cachePath, cache);
    }

    console.log(chalk.green(`\n🎉 导入完成，共处理表数量: ${totalTables}`));
    if (cachedFiles) {
      console.log(chalk.gray(`   使用缓存文件数: ${cachedFiles}`));
    }
    if (args.dryRun) {
      console.log(chalk.yellow(`   预览模式生成表数量: ${dryRunGeneratedTables}`));
    }

    if (!args.dryRun) {
      if ((args.target === 'client' || args.target === 'both') && clientTableDescriptors.length) {
        await generateInterfacesIndexFile(clientTableDescriptors, interfaceClientDir);
      }

      if ((args.target === 'server' || args.target === 'both') && serverTableDescriptors.length) {
        await generateInterfacesIndexFile(serverTableDescriptors, interfaceServerDir);
      }

      const plugins = createDefaultGeneratorPlugins();
      const pluginResult = await runGeneratorPlugins({
        plugins,
        target: args.target,
        languages: args.languages,
        tablesByScope: {
          server: serverTableDescriptors,
          client: clientTableDescriptors,
        },
        outRoot,
        interfaceDirs: {
          server: interfaceServerDir,
          client: interfaceClientDir,
        },
        failOnPluginError: args.failOnPluginError,
        pluginOptions: {
          csharpNamespace: args.csharpNamespace,
        },
      });

      if (pluginResult.failed.length) {
        console.log(chalk.red(`❌ 插件失败数量: ${pluginResult.failed.length}`));
        pluginResult.failed.forEach((item) => {
          console.log(chalk.red(`   - ${item.name}: ${item.message}`));
        });
        if (args.failOnPluginError) {
          process.exit(1);
        }
      }
    } else {
      console.log(chalk.yellow('   预览模式：已跳过接口索引与插件生成'));
    }

    if (errorSummary.size) {
      console.log(chalk.red('\n📋 错误汇总'));
      for (const [filePath, messages] of errorSummary.entries()) {
        console.log(chalk.red(`➡  处理: ${filePath}`));
        messages.forEach((message) => {
          console.log(chalk.red(`    ❌ ${message}`));
        });
      }
    }

    if (warningSummary.size) {
      console.log(chalk.yellow('\n📋 警告汇总'));
      for (const [filePath, messages] of warningSummary.entries()) {
        console.log(chalk.yellow(`➡  处理: ${filePath}`));
        messages.forEach((message) => {
          console.log(chalk.yellow(`    ⚠️ ${message}`));
        });
      }
    }
  } catch (err) {
    console.error(chalk.red('❌ 导入过程发生未捕获错误'));
    console.error(err);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 *
 * 支持:
 *   --input / --in / -i / --input= 指定 XLSX 输入目录或单个文件
 *   --out-dir / --out-dir=        指定输出根目录
 *   --target / --target=          指定生成目标：server | client | both
 *   --pretty                      JSON 格式化输出（默认开启，2 空格）
 *   --minify                      JSON 最小化输出（spaces=0）
 *   --language / --lang           生成语言（默认 ts，可用: ts,csharp，逗号分隔）
 *   --strict                      严格校验，遇到错误立即中止
 *   --dry-run                     仅预览变更，不写文件
 *   --cache-clear                 强制清空缓存
 *   --fail-on-plugin-error        插件失败时退出
 *   --csharp-namespace            指定 C# 命名空间
 */
function parseArgs(argv) {
  let input = 'input/xlsx';
  let outDir = 'output';
  let target = 'both'; // server | client | both
  let jsonSpaces = 2;
  let languages = ['ts'];
  let strict = false;
  let dryRun = false;
  let cacheClear = false;
  let failOnPluginError = false;
  let csharpNamespace = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if ((arg === '--input' || arg === '--in' || arg === '-i') && argv[i + 1]) {
      input = argv[++i];
    } else if (arg.startsWith('--input=')) {
      input = arg.split('=')[1];
    } else if (arg === '--out-dir' && argv[i + 1]) {
      outDir = argv[++i];
    } else if (arg.startsWith('--out-dir=')) {
      outDir = arg.split('=')[1];
    } else if (arg === '--target' && argv[i + 1]) {
      target = argv[++i];
    } else if (arg.startsWith('--target=')) {
      target = arg.split('=')[1];
    } else if (arg === '--pretty') {
      jsonSpaces = 2;
    } else if (arg === '--minify') {
      jsonSpaces = 0;
    } else if (arg === '--strict') {
      strict = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--cache-clear') {
      cacheClear = true;
    } else if (arg === '--fail-on-plugin-error') {
      failOnPluginError = true;
    } else if (arg === '--csharp-namespace' && argv[i + 1]) {
      csharpNamespace = argv[++i];
    } else if ((arg === '--language' || arg === '--lang') && argv[i + 1]) {
      languages = argv[++i].split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    } else if (arg.startsWith('--language=')) {
      languages = arg.split('=')[1].split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    } else if (arg.startsWith('--lang=')) {
      languages = arg.split('=')[1].split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    } else if (arg.startsWith('--csharp-namespace=')) {
      csharpNamespace = arg.split('=')[1];
    }
  }

  target = (target || '').toLowerCase();
  if (!['server', 'client', 'both'].includes(target)) {
    target = 'both';
  }

  if (!languages.length) {
    languages = ['ts'];
  }

  return {
    input,
    outDir,
    target,
    jsonSpaces,
    languages,
    strict,
    dryRun,
    cacheClear,
    failOnPluginError,
    csharpNamespace,
  };
}

function normalizeLanguages(languages) {
  if (!Array.isArray(languages) || languages.length === 0) {
    return 'ts';
  }

  return Array.from(
    new Set(
      languages
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    )
  )
    .sort()
    .join(',');
}

if (require.main === module) {
  main();
}

module.exports = main;
