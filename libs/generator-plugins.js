const path = require('path');
const { generateClientTemplates } = require('./templates/ts/generate-client-template');
const { generateServerTemplates } = require('./templates/ts/generate-server-template');
const { generateCSharpTemplates } = require('./templates/csharp/generate-csharp-template');

/**
 * 生成器插件集合
 *
 * 输入：
 * - 表描述集合（server/client）
 * - 输出根目录与接口目录
 *
 * 输出：
 * - 通过插件生成各端模板产物
 */
function createDefaultGeneratorPlugins() {
  return [
    {
      name: 'client-template',
      scope: 'client',
      language: 'ts',
      version: '1.0.0',
      output: 'output/client',
      run: async ({ tables, outRoot }) => {
        await generateClientTemplates(tables, { outputRoot: path.join(outRoot, 'client') });
      },
    },
    {
      name: 'server-template',
      scope: 'server',
      language: 'ts',
      version: '1.0.0',
      output: 'output/server/facades',
      run: async ({ tables, outRoot, interfaceDirs }) => {
        await generateServerTemplates(tables, {
          facadePath: path.join(outRoot, 'server', 'facades'),
          interfacesPath: interfaceDirs.server,
        });
      },
    },
    {
      name: 'csharp-template',
      scope: 'client',
      language: 'csharp',
      version: '1.0.0',
      output: 'output/client-csharp',
      run: async ({ tables, outRoot, pluginOptions }) => {
        await generateCSharpTemplates(tables, {
          outputRoot: path.join(outRoot, 'client-csharp'),
          namespaceName: pluginOptions?.csharpNamespace,
        });
      },
    },
  ];
}

/**
 * 执行生成器插件
 *
 * @param {{
 *   plugins: Array<{name: string, scope: 'server'|'client', language: string, run: Function}>,
 *   target: 'server'|'client'|'both',
 *   languages: string[],
 *   tablesByScope: {server: any[], client: any[]},
 *   outRoot: string,
 *   interfaceDirs: {server: string, client: string},
 *   failOnPluginError?: boolean,
 *   pluginOptions?: {csharpNamespace?: string},
 * }} options
 */
async function runGeneratorPlugins(options) {
  const {
    plugins,
    target,
    languages,
    tablesByScope,
    outRoot,
    interfaceDirs,
    failOnPluginError,
    pluginOptions,
  } = options;
  const targetScopes = target === 'both' ? ['server', 'client'] : [target];
  const enabledLanguages = Array.isArray(languages) && languages.length ? languages : ['ts'];
  const failed = [];

  for (const plugin of plugins) {
    if (!targetScopes.includes(plugin.scope)) {
      continue;
    }
    if (!enabledLanguages.includes(plugin.language)) {
      continue;
    }

    const tables = tablesByScope[plugin.scope] || [];
    if (!tables.length) {
      continue;
    }

    try {
      await plugin.run({ tables, outRoot, interfaceDirs, pluginOptions });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      failed.push({ name: plugin.name, message });
      console.error(`❌ 生成器插件失败: ${plugin.name} (${plugin.scope})`);
      console.error(`   ${message}`);
      if (failOnPluginError) {
        break;
      }
    }
  }

  return { failed };
}

module.exports = {
  createDefaultGeneratorPlugins,
  runGeneratorPlugins,
};
