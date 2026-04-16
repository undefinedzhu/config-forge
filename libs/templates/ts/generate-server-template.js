const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

/**
 * 服务器端 Facade 模板生成器
 *
 * 输入：
 * - XLSX 转换得到的表描述（table descriptors）
 * - 输出目录（默认 output/server/facades）
 *
 * 输出：
 * - game-config.facade.ts / business-types.ts
 */

/**
 * 生成 GameConfigFacade 类（无装饰器，完全静态生成）
 *
 * @param {string} facadePath 输出目录，默认 output/server/facades
 * @param {Array<{fileName: string, interfaceName: string, metaName: string, tableName: string, accessorName: string}>} interfaces
 */
async function generateFacadeClass(facadePath, interfaces) {
  const imports = generateImports(interfaces);
  const accessorDeclarations = generateAccessorDeclarations(interfaces);
  const accessorInits = generateAccessorInits(interfaces);

  const facadeContent = `${imports}

/**
 * 游戏配置统一访问门面
 *
 * 🔥 此文件由工具自动生成，请勿手动修改
 *
 * 功能：
 * - 提供配置表的统一访问接口
 * - 完整的TypeScript类型安全
 * - 统一的CRUD操作（get, getAll, getBatch, search）
 *
 * 使用方式：
 * \`\`\`typescript
 * const hero = await this.gameConfig.hero.get(123);
 * const items = await this.gameConfig.item.getBatch([1,2,3]);
 * \`\`\`
 *
 * 重新生成：npm run config:facade
 */
@Injectable()
export class GameConfigFacade {
${accessorDeclarations}

  constructor(private readonly configManager: ConfigManager) {
    this.initializeTableAccessors();
  }

  /**
   * 初始化所有表访问器
   */
  private initializeTableAccessors(): void {
${accessorInits}
  }
}
`;

  await fs.writeFile(
    path.join(facadePath, 'game-config.facade.ts'),
    facadeContent
  );
}

/**
 * 生成 Facade 文件顶部的导入语句
 *
 * 说明：
 *   - 使用解构导入而非 `* as Interfaces`，便于 IDE 联想与 tree-shaking
 */
function generateImports(interfaces) {
  // 将所有接口名收集起来并排序，使用解构导入
  const interfaceNames = interfaces.map(iface => iface.interfaceName).sort();

  // 分组导入，每行最多 5 个接口，保持代码可读性
  const importGroups = [];
  for (let i = 0; i < interfaceNames.length; i += 5) {
    const group = interfaceNames.slice(i, i + 5);
    importGroups.push(`  ${group.join(', ')}`);
  }

  return `import {
${importGroups.join(',\n')}
} from '../interfaces';
import { Injectable } from '@nestjs/common';
import { ConfigManager } from '../core/config-manager.service';
import { ConfigTableAccessor } from './business-types';`;
}

/**
 * 为每个配置表生成 GameConfigFacade 上的访问器字段声明
 */
function generateAccessorDeclarations(interfaces) {
  return interfaces.map(iface =>
    `  ${iface.accessorName}: ConfigTableAccessor<${iface.interfaceName}>;`
  ).join('\n');
}

/**
 * 为每个配置表生成访问器初始化代码
 */
function generateAccessorInits(interfaces) {
  return interfaces.map(iface => `    this.${iface.accessorName} = {
      get: (id: number) => this.configManager.get<${iface.interfaceName}>('${iface.tableName}', id),
      getAll: () => this.configManager.getAll<${iface.interfaceName}>('${iface.tableName}'),
      getBatch: (ids: number[]) => this.configManager.getBatch<${iface.interfaceName}>('${iface.tableName}', ids),
      search: (keyword: string) => this.configManager.search<${iface.interfaceName}>('${iface.tableName}', keyword),
      filter: (predicate: (item: ${iface.interfaceName}) => boolean) => this.configManager.filter<${iface.interfaceName}>('${iface.tableName}', predicate),
      findBy: (field: keyof ${iface.interfaceName}, value: any) => this.configManager.findBy<${iface.interfaceName}>('${iface.tableName}', field, value),
      findOne: (predicate: (item: ${iface.interfaceName}) => boolean) => this.configManager.findOne<${iface.interfaceName}>('${iface.tableName}', predicate),
      findOneBy: (field: keyof ${iface.interfaceName}, value: any) => this.configManager.findOneBy<${iface.interfaceName}>('${iface.tableName}', field, value)
    };`).join('\n\n');
}

/**
 * 将表名转换为访问器属性名
 *
 * 规则：首字母小写，保持剩余部分不变
 */
function toAccessorName(tableName) {
  return tableName.charAt(0).toLowerCase() + tableName.slice(1);
}

/**
 * 在 Facade 目录下生成 ConfigTableAccessor<T> 基础类型定义
 */
async function generateBusinessTypes(facadePath) {
  const businessTypesContent = `// 配置表访问器类型定义

/**
 * 配置表访问器接口
 * 提供统一的配置表访问方法，包括基础CRUD操作和高级筛选功能
 */
export interface ConfigTableAccessor<T> {
   /**
   * 根据ID获取单个配置项
   * @param id 配置项的唯一标识符
   * @returns 配置项对象，如果不存在则返回null
   * @example
   * \`\`\`typescript
   * const hero = await this.gameConfig.hero.get(123);
   * if (hero) {
   *   console.log(hero.name);
   * }
   * \`\`\`
   */
  get(id: number): Promise<T | null>;

  /**
   * 获取所有配置项
   * @returns 所有配置项的数组
   * @example
   * \`\`\`typescript
   * const allHeroes = await this.gameConfig.hero.getAll();
   * console.log(\`总共有 \${allHeroes.length} 个英雄\`);
   * \`\`\`
   */
  getAll(): Promise<T[]>;

  /**
   * 批量获取配置项
   * @param ids 配置项ID数组
   * @returns Map对象，键为ID，值为配置项
   * @example
   * \`\`\`typescript
   * const heroMap = await this.gameConfig.hero.getBatch([1, 2, 3]);
   * const hero1 = heroMap.get(1);
   * \`\`\`
   */
  getBatch(ids: number[]): Promise<Map<number, T>>;

  /**
   * 根据关键词搜索配置项
   * @param keyword 搜索关键词
   * @returns 匹配的配置项数组
   * @example
   * \`\`\`typescript
   * const heroes = await this.gameConfig.hero.search('法师');
   * \`\`\`
   */
  search(keyword: string): Promise<T[]>;

  /**
   * 根据自定义条件筛选配置项
   * @param predicate 筛选条件函数，返回true的项目会被包含在结果中
   * @returns 符合条件的配置项数组
   * @example
   * \`\`\`typescript
   * // 筛选等级大于10的英雄
   * const highLevelHeroes = await this.gameConfig.hero.filter(
   *   hero => hero.level > 10
   * );
   *
   * // 筛选特定位置和等级的英雄
   * const tankHeroes = await this.gameConfig.hero.filter(
   *   hero => hero.position === 'tank' && hero.level >= 5
   * );
   * \`\`\`
   */
  filter(predicate: (item: T) => boolean): Promise<T[]>;

  /**
   * 根据指定字段和值筛选配置项
   * @param field 要筛选的字段名
   * @param value 字段值
   * @returns 字段值匹配的配置项数组
   * @example
   * \`\`\`typescript
   * // 获取指定队伍的所有英雄配置
   * const teamPlayers = await this.gameConfig.team.findBy('teamId', 90101);
   *
   * // 获取指定位置的所有英雄
   * const goalkeepers = await this.gameConfig.hero.findBy('position', 'GK');
   *
   * // 获取指定等级的所有物品
   * const level5Items = await this.gameConfig.item.findBy('level', 5);
   * \`\`\`
   */
  findBy(field: keyof T, value: any): Promise<T[]>;

  /**
   * 根据自定义条件查找第一个匹配的配置项
   * @param predicate 查找条件函数
   * @returns 第一个符合条件的配置项，如果没有找到则返回null
   * @example
   * \`\`\`typescript
   * // 查找第一个满足条件的英雄
   * const firstMage = await this.gameConfig.hero.findOne(
   *   hero => hero.type === 'mage' && hero.level > 10
   * );
   *
   * // 查找特定名称的配置
   * const specificHero = await this.gameConfig.hero.findOne(
   *   hero => hero.name === '悟空'
   * );
   * \`\`\`
   */
  findOne(predicate: (item: T) => boolean): Promise<T | null>;

  /**
   * 根据指定字段和值查找第一个匹配的配置项
   * @param field 要查找的字段名
   * @param value 字段值
   * @returns 第一个字段值匹配的配置项，如果没有找到则返回null
   * @example
   * \`\`\`typescript
   * // 查找指定ID的配置（等同于get方法，但更灵活）
   * const hero = await this.gameConfig.hero.findOneBy('heroId', 90001);
   *
   * // 查找指定名称的配置
   * const hero = await this.gameConfig.hero.findOneBy('name', '悟空');
   *
   * // 查找指定类型的第一个配置
   * const firstShop = await this.gameConfig.shop.findOneBy('type', 'weapon');
   * \`\`\`
   */
  findOneBy(field: keyof T, value: any): Promise<T | null>;
}
`;

  await fs.writeFile(
    path.join(facadePath, 'business-types.ts'),
    businessTypesContent
  );
}

/**
 * 清空 Facade 目录中的旧产物
 *
 * 仅删除 .ts 文件，保留目录结构及其它非 TS 文件
 */
async function cleanFacadeDirectory(facadePath) {
  console.log(chalk.gray('🧹 清空旧的Facade文件...'));

  try {
    // 检查目录是否存在
    if (await fs.pathExists(facadePath)) {
      // 读取目录中的所有文件
      const files = await fs.readdir(facadePath);

      // 删除所有.ts文件
      const filesToDelete = files.filter(file => file.endsWith('.ts'));

      if (filesToDelete.length > 0) {
        console.log(chalk.gray(`   删除 ${filesToDelete.length} 个旧Facade文件...`));

        for (const file of filesToDelete) {
          const filePath = path.join(facadePath, file);
          await fs.remove(filePath);
          console.log(chalk.gray(`   - 删除: ${file}`));
        }
      } else {
        console.log(chalk.gray('   没有找到需要删除的旧Facade文件'));
      }
    } else {
      console.log(chalk.gray('   Facade目录不存在，将创建新目录'));
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️  清空Facade目录时出错: ${error.message}`));
    // 不抛出错误，继续执行
  }
}
/**
 * 将 XLSX 解析结果转换为服务器端 Facade 生成所需的接口描述结构
 *
 * @param {Array} tables XLSX 解析得到的表描述
 * @param {(tableName: string) => string} accessorNameBuilder 访问器命名构造函数
 */
function buildServerInterfacesFromTables(tables, accessorNameBuilder) {
  if (!Array.isArray(tables)) return [];

  return tables
    .map((t) => {
      const tableName = t.tableName;
      if (!tableName) {
        return null;
      }

      const interfaceName = t.interfaceName || `${tableName}Definition`;
      const accessorName =
        (typeof accessorNameBuilder === 'function' && accessorNameBuilder(tableName)) ||
        tableName.charAt(0).toLowerCase() + tableName.slice(1);

      return {
        fileName: `${tableName}.interface`,
        interfaceName,
        metaName: t.metaName || `${tableName}${t.scope === 'server' ? 'Server' : 'Client'}Meta`,
        tableName,
        accessorName,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.tableName.localeCompare(b.tableName));
}

/**
 * 服务器端 Facade 模板生成主入口
 *
 * @param {Array} tables XLSX 解析得到的表描述
 * @param {{facadePath?: string, interfacesPath?: string}} options 输出配置
 */
async function generateServerTemplates(tables, options = {}) {
  // 默认输出到 output/server/facades，接口目录为 ../interfaces
  const rootDir = process.cwd();
  const defaultFacadePath = path.join(rootDir, 'output', 'server', 'facades');
  const facadePath = options.facadePath || defaultFacadePath;

  const interfaces = buildServerInterfacesFromTables(tables, (tableName) =>
    toAccessorName(tableName)
  );

  console.log(chalk.yellow(`\n[Server] 生成 Facade，表数量: ${interfaces.length}`));

  // 清理并生成
  await cleanFacadeDirectory(facadePath);
  await fs.ensureDir(facadePath);
  await generateFacadeClass(facadePath, interfaces);
  await generateBusinessTypes(facadePath);

  console.log(chalk.green('[Server] 完成 Facade 与 business-types 生成'));
}

module.exports = {
  generateServerTemplates,
  buildServerInterfacesFromTables,
};
