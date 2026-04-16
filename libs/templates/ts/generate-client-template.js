#!/usr/bin/env node
/**
 * 客户端配置模板生成器
 *
 * 输入：
 * - XLSX 转换后的表描述（table descriptors）
 * - 输出目录（默认 output/client）
 *
 * 输出：
 * - ConfigRegistry.ts / ConfigAccessor.ts / index.ts
 *
 * 说明：该工具只依赖表描述，不直接解析 XLSX/JSON，便于独立演进。
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// 默认输出路径（项目根目录下的 output/client）
const ROOT_DIR = process.cwd();
const COCOS_SCRIPT_DIR = path.join(ROOT_DIR, 'output', 'client');

// 生成配置注册文件
/**
 * 生成客户端配置注册表 ConfigRegistry.ts
 *
 * @param {Array<{tableName: string, jsonFile: string, primaryKey: string, camelCaseName: string}>} interfaces
 *        由 XLSX 解析结果映射而来的表描述
 * @param {string} scriptDir
 *        输出目录，默认 output/client
 */
function generateConfigRegistry(interfaces, scriptDir = COCOS_SCRIPT_DIR) {
  console.log(chalk.cyan('\n[Client] 生成 ConfigRegistry.ts'));

  const registryPath = path.join(scriptDir, 'ConfigRegistry.ts');

  // 生成注册配置数组
  const registrations = interfaces.map(({ tableName, jsonFile, primaryKey }) => {
    return `  {
    tableName: '${tableName}',
    path: 'bundle/json/${jsonFile}',
    primaryKey: '${primaryKey}',
    preload: true
  }`;
  }).join(',\n');

  const content = `/**
 * 游戏配置注册表
 * 🔥 此文件由工具自动生成，请勿手动修改
 * 生成时间: ${new Date().toISOString()}
 *
 * 使用方式：
 * \`\`\`typescript
 * import { registerAllConfigs } from './config/ConfigRegistry';
 * import { tableManager } from '@/framework';
 *
 * // 注册所有配置表
 * registerAllConfigs();
 *
 * // 预加载配置
 * await tableManager.preloadAll((loaded, total, tableName) => {
 *   console.log(\`加载进度: \${loaded}/\${total} - \${tableName}\`);
 * });
 * \`\`\`
 */

import { tableManager, TableConfig } from '@/framework';

/**
 * 所有配置表的注册信息
 */
export const CONFIG_TABLES: TableConfig[] = [
${registrations}
];

/**
 * 注册所有配置表
 */
export function registerAllConfigs(): void {
  console.log('[ConfigRegistry] 开始注册配置表...');
  tableManager.registerBatch(CONFIG_TABLES);
  console.log(\`[ConfigRegistry] 注册完成: \${CONFIG_TABLES.length} 个配置表\`);
}

/**
 * 配置表名称常量
 */
export const CONFIG_TABLE_NAMES = {
${interfaces.map(({ tableName, camelCaseName }) => `  ${camelCaseName.toUpperCase()}: '${tableName}'`).join(',\n')}
} as const;
`;

  fs.writeFileSync(registryPath, content, 'utf-8');
  console.log(chalk.green(`[Client] 完成 ConfigRegistry.ts（${interfaces.length} 个配置表）`));
}

// 生成配置访问器（使用辅助类封装通用逻辑）
/**
 * 生成类型安全的配置访问器 ConfigAccessor.ts
 *
 * 每个配置表会生成一个强类型访问器属性，便于在游戏逻辑中通过
 * `configAccessor.xxx` 方式访问表数据，避免手写字符串表名和泛型。
 *
 * @param {Array<{tableName: string, camelCaseName: string, interfaceName: string}>} interfaces
 * @param {string} scriptDir 输出目录
 */
function generateConfigAccessor(interfaces, scriptDir = COCOS_SCRIPT_DIR) {
  console.log(chalk.cyan('\n[Client] 生成 ConfigAccessor.ts'));

  const accessorPath = path.join(scriptDir, 'ConfigAccessor.ts');

  // 生成接口导入语句
  const imports = interfaces.map(({ interfaceName }) => interfaceName).join(', ');

  // 生成每个配置表的访问器属性声明
  const accessorProperties = interfaces.map(({ tableName, camelCaseName, interfaceName }) => {
    return `  /** ${tableName} 配置表访问器 */\n  readonly ${camelCaseName} = new TableAccessorHelper<${interfaceName}>('${tableName}');`;
  }).join('\n\n');

  const content = `/**
 * 游戏配置访问器
 * 🔥 此文件由工具自动生成，请勿手动修改
 * 生成时间: ${new Date().toISOString()}
 *
 * 提供完全类型安全的配置访问方法
 * 每个配置表都有专属的访问器属性，支持IDE自动补全
 *
 * 使用示例：
 * \`\`\`typescript
 * import { configAccessor } from '@/config';
 *
 * // 完全类型安全，无需手动指定泛型
 * const hero = await configAccessor.hero.get(101000);
 * // hero 的类型自动推导为 HeroDefinition | null
 *
 * const allItems = await configAccessor.item.getAll();
 * // allItems 的类型自动推导为 ItemDefinition[]
 *
 * const rareHeroes = await configAccessor.hero.filter(h => h.rarity >= 4);
 * // rareHeroes 的类型自动推导为 HeroDefinition[]
 *
 * const warriors = await configAccessor.hero.findBy('type', 'Warrior');
 * // warriors 的类型自动推导为 HeroDefinition[]
 * \`\`\`
 */

import { ${imports} } from './interfaces';
import { tableManager } from '@/framework';

/**
 * 配置表访问器辅助类
 * 封装所有配置表的通用访问方法，避免代码重复
 */
class TableAccessorHelper<T> {
  constructor(private readonly tableName: string) {}

  /**
   * 根据ID获取单个配置
   * @param id 配置ID
   * @returns 配置对象，不存在则返回null
   */
  get = (id: number | string): Promise<T | null> => {
    return tableManager.get<T>(this.tableName, id);
  };

  /**
   * 获取所有配置
   * @returns 配置数组
   */
  getAll = (): Promise<T[]> => {
    return tableManager.getAll<T>(this.tableName);
  };

  /**
   * 批量获取配置
   * @param ids 配置ID数组
   * @returns 配置Map，键为ID，值为配置对象
   */
  getBatch = (ids: (number | string)[]): Promise<Map<number | string, T>> => {
    return tableManager.getBatch<T>(this.tableName, ids);
  };

  /**
   * 根据字段筛选配置
   * @param field 字段名
   * @param value 字段值
   * @returns 符合条件的配置数组
   */
  findBy = (field: keyof T, value: any): Promise<T[]> => {
    return tableManager.findBy<T>(this.tableName, field, value);
  };

  /**
   * 根据自定义条件筛选配置
   * @param predicate 筛选条件函数
   * @returns 符合条件的配置数组
   */
  filter = (predicate: (item: T) => boolean): Promise<T[]> => {
    return tableManager.filter<T>(this.tableName, predicate);
  };

  /**
   * 根据自定义条件查找第一个匹配的配置
   * @param predicate 查找条件函数
   * @returns 第一个符合条件的配置，不存在则返回null
   */
  findOne = (predicate: (item: T) => boolean): Promise<T | null> => {
    return tableManager.findOne<T>(this.tableName, predicate);
  };

  /**
   * 根据字段查找第一个匹配的配置
   * @param field 字段名
   * @param value 字段值
   * @returns 第一个符合条件的配置，不存在则返回null
   */
  findOneBy = (field: keyof T, value: any): Promise<T | null> => {
    return tableManager.findOneBy<T>(this.tableName, field, value);
  };

  /**
   * 获取配置数量
   * @returns 配置数量
   */
  count = (): Promise<number> => {
    return tableManager.count(this.tableName);
  };

  /**
   * 热重载配置表
   */
  reload = (): Promise<void> => {
    return tableManager.reload(this.tableName);
  };
}

/**
 * 配置访问器类
 * 为每个配置表提供强类型访问器
 */
export class ConfigAccessor {
  private static instance: ConfigAccessor;

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): ConfigAccessor {
    if (!ConfigAccessor.instance) {
      ConfigAccessor.instance = new ConfigAccessor();
    }
    return ConfigAccessor.instance;
  }

${accessorProperties}
}

// 导出单例实例
export const configAccessor = ConfigAccessor.getInstance();
`;

  fs.writeFileSync(accessorPath, content, 'utf-8');

  // 计算代码行数
  const lineCount = content.split('\n').length;
  console.log(chalk.green(`[Client] 完成 ConfigAccessor.ts（${interfaces.length} 个配置表, ${lineCount} 行）`));
  console.log(chalk.gray(`   代码行数: ~${interfaces.length * 90} → ${lineCount}`));
}




// 生成统一导出文件
/**
 * 生成客户端配置入口 index.ts
 *
 * 统一导出：
 *   - interfaces（由 XLSX → JSON → interface 生成）
 *   - ConfigRegistry（注册表）
 *   - ConfigAccessor（访问器）
 */
function generateIndexFile(interfaces, scriptDir = COCOS_SCRIPT_DIR) {
  console.log(chalk.cyan('\n[Client] 生成 index.ts'));

  const indexPath = path.join(scriptDir, 'index.ts');

  const content = `/**
 * 游戏配置统一导出
 * 🔥 此文件由工具自动生成，请勿手动修改
 * 生成时间: ${new Date().toISOString()}
 */

// 导出所有接口定义
export * from './interfaces';

// 导出配置注册
export { registerAllConfigs, CONFIG_TABLES, CONFIG_TABLE_NAMES } from './ConfigRegistry';

// 导出配置访问器
export { ConfigAccessor, configAccessor } from './ConfigAccessor';
`;

  fs.writeFileSync(indexPath, content, 'utf-8');
  console.log(chalk.green('[Client] 完成 index.ts'));
}

/**
 * 将 XLSX 解析得到的表描述转换为客户端模板生成所需的结构
 *
 * @param {Array<{tableName: string, jsonFileName?: string, primaryKey?: string, interfaceName?: string, camelCaseName?: string}>} tables
 * @returns {Array<{interfaceName: string, tableName: string, fileName: string, jsonFile: string, primaryKey: string, camelCaseName: string}>}
 */
function buildInterfacesFromTables(tables) {
  if (!Array.isArray(tables)) return [];

  const interfaces = tables.map((t) => {
    const tableName = t.tableName;
    const interfaceName = t.interfaceName || `${tableName}Definition`;
    const jsonFile = t.jsonFileName || `${tableName}.json`;
    const primaryKey = t.primaryKey || 'id';
    const camelCaseName = t.camelCaseName || (tableName ? tableName.charAt(0).toLowerCase() + tableName.slice(1) : tableName);

    return {
      interfaceName,
      tableName,
      fileName: tableName,
      jsonFile,
      primaryKey,
      camelCaseName,
    };
  });

  return interfaces.sort((a, b) => a.tableName.localeCompare(b.tableName));
}

/**
 * 客户端模板生成主入口
 *
 * 由 XLSX 转换工具调用，基于表描述生成：
 *   - ConfigRegistry.ts
 *   - ConfigAccessor.ts
 *   - index.ts
 *
 * @param {Array} tables XLSX 解析得到的表描述
 * @param {{outputRoot?: string}} options 输出目录配置
 */
async function generateClientTemplates(tables, options = {}) {
  const scriptDir = options.outputRoot || COCOS_SCRIPT_DIR;
  const interfaces = buildInterfacesFromTables(tables);
  console.log(chalk.yellow(`\n[Client] 生成客户端模板，表数量: ${interfaces.length}`));
  generateConfigRegistry(interfaces, scriptDir);
  generateConfigAccessor(interfaces, scriptDir);
  generateIndexFile(interfaces, scriptDir);
}

module.exports = {
  generateClientTemplates,
  buildInterfacesFromTables,
};
