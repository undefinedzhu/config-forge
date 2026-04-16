# ConfigForge（XLSX → JSON 与 TypeScript 接口生成工具）

ConfigForge 是一套**面向开源发布的表格驱动配置流水线**，用于将策划配置表（XLSX）转换为运行时代码资源，包括：

- 生成服务器 / 客户端共用的 JSON 配置文件
- 生成对应的 TypeScript 接口定义（`*.interface.ts`）
- 生成客户端辅助代码（`ConfigRegistry.ts`、`ConfigAccessor.ts`、`index.ts`）
- 生成服务端 Facade 与业务类型定义（`game-config.facade.ts`、`business-types.ts`）

该工具既可以作为**独立包**使用，也可以嵌入到更大的工程中，具备清晰、可重复的构建流程。

> 所有生成文件都视为构建产物，请勿手动修改，重新生成时会被覆盖。

---

## 0. 快速开始

1. 安装依赖：
   ```bash
   npm install
   ```
2. 将配置表放入 `input/xlsx`。
3. 生成产物：
   ```bash
   node convert-xlsx-to-config.js
   ```
4. 查看输出目录：`output/client` 与 `output/server`。

---

## 1. 功能概览

- **XLSX → JSON**
  - 从指定目录读取一个或多个 `.xlsx` 文件
  - 按照 server / client 作用域生成对应的 JSON 文件
- **XLSX → TypeScript 接口**
  - 按统一的命名规则生成每张表的 `*.interface.ts`
  - 生成 `index.ts` 作为接口聚合入口
  - 使用表头中的“显示名”作为字段注释
- **辅助开发代码生成**
  - 客户端：`ConfigRegistry.ts`、`ConfigAccessor.ts`、`index.ts`
  - 服务端：`game-config.facade.ts` 与 `business-types.ts`
- **增量生成与缓存**
  - 基于 XLSX 哈希生成缓存清单 `output/.cache.json`
  - 未变更文件跳过生成，提升大型项目速度
- **JSON 输出格式**
  - `--pretty` 格式化 JSON（默认 2 空格缩进）
  - `--minify` 输出最小化 JSON
- **模块化与插件机制**
  - 核心模块：parser / validator / generator / io / cache
  - 模板生成通过插件流水线执行
- **C# 模型生成**
  - 生成 C# 配置模型到 `output/client-csharp`
- **简洁友好的 CLI 日志**
  - 使用 `[Client]` / `[Server]` 前缀区分模块
  - 只输出必要信息，便于在开发中频繁执行

---

## 2. 配置表规范（config-spreadsheet-spec）

工具遵循本项目内部的 **config-spreadsheet-spec** 规范。

一个 XLSX 文件：

- 可以包含多张 **配置 Sheet**（每张 Sheet 对应一张逻辑表）
- 可以包含一张可选的 `__meta__` Sheet，用于描述各配置表的元信息

每张配置 Sheet 使用 **5 行表头**，后面是数据行：

1. **显示名**（例如 `编号【KEY】`，用于生成字段注释）
2. **字段名**（代码中的字段名，例如 `id`）
3. **类型**（例如 `int`、`string`、`bool`、`int[]` 等）
4. **Server 标记**（`server` / 空）—— 该字段是否对服务器可见
5. **Client 标记**（`client` / 空）—— 该字段是否对客户端可见

数据从第 6 行开始。

如果存在 `__meta__` Sheet，则每一行描述一张表，包括但不限于：

- `SheetName` —— 在 XLSX 中的 Sheet 名称
- `TableName` —— 逻辑表名（一般为 PascalCase）
- `JsonFileName` —— 输出 JSON 文件名（如 `Hero.json`）
- `PrimaryKey` —— 主键字段名（如 `id`）
- `Description` —— 表的中文描述

如果缺少 `__meta__`，工具会退化为直接从各个 Sheet 推断元信息。

更详细的规范说明见本目录下的 `config-spreadsheet-spec.md`。

---

## 3. 目录结构

当前目录结构（简化）：

- `convert-xlsx-to-config.js`
  - 主 CLI 入口，从 XLSX 生成 JSON + TS 接口，并调用客户端 / 服务端模板生成器
- `libs/templates/ts/generate-client-template.js`
  - 客户端辅助代码生成（`ConfigRegistry` / `ConfigAccessor` / `index.ts`）
- `libs/templates/ts/generate-server-template.js`
  - 服务端辅助代码生成（Facade / `business-types.ts`）
- `libs/templates/csharp/generate-csharp-template.js`
  - C# 配置模型生成
- `libs/core/`
  - 核心模块：parser / validator / generator / io / cache
- `libs/generator-plugins.js`
  - 模板生成插件流水线
- `input/xlsx/`
  - 默认的 XLSX 输入目录（每个 `.xlsx` 为一批配置表）
- `output/`
  - 默认输出根目录
  - 增量缓存清单：`output/.cache.json`

默认输出结构如下：

```text
output/
  client/
    json/
      *.json
    interfaces/
      *.interface.ts
      index.ts
    ConfigRegistry.ts
    ConfigAccessor.ts
    index.ts
  server/
    json/
      *.json
    interfaces/
      *.interface.ts
      index.ts
    facades/
      game-config.facade.ts
      business-types.ts
  client-csharp/
    *.cs
    ConfigTableNames.cs
```

这些路径都可以通过 CLI 参数或调用生成函数时的参数进行定制。

---

## 3.1 JSON → 表格辅助工具（convert-json-to-table.js）

除了从 XLSX 正向生成 JSON，本目录还提供了一个**反向导出工具**：

- `convert-json-to-table.js`
  - 读取运行期使用的 JSON 数据（例如 `libs/game-config/src/data/*.json`）
  - 只处理顶层为对象数组的 JSON（形如 `[ { ... }, { ... } ]`）
  - 合并所有对象的 key 作为表头字段
  - 为每个 JSON 文件导出对应的 `.csv` 和/或 `.xlsx` 到指定输出目录

生成的 **XLSX** 文件遵循与 `convert-xlsx-to-config.js` 相同的「5 行表头 + `__meta__`」规范，因此可以：

- 将已有 JSON 配置导出为 XLSX
- 在表格工具中打开并编辑这些配置
- 再将更新后的 XLSX 交给 `convert-xlsx-to-config.js` 正向生成 JSON / 接口

典型用法（在 ConfigForge 项目根目录执行）：

```bash
node convert-json-to-table.js

# 仅导出 XLSX
node convert-json-to-table.js --format xlsx

# 同时导出 CSV 与 XLSX
node convert-json-to-table.js --format csv,xlsx

# 导出到 config-forge/input，便于直接作为 convert-xlsx-to-config.js 的输入
node convert-json-to-table.js --out-dir input
```

当你已经有一套较稳定的 JSON 配置，但希望引入「表格驱动配置」工作流时，这个反向导出工具会非常实用。

---

## 4. 在本项目中使用（从此目录执行）

主入口脚本为 `convert-xlsx-to-config.js`。

### 4.1 直接用 Node 执行

在 ConfigForge 目录（`config-forge`）下运行：

```bash
node convert-xlsx-to-config.js
```

该命令会：

- 从 `input/xlsx` 目录读取所有 `.xlsx` 文件
- 同时生成 **server** 和 **client** 的 JSON 与接口文件
- 重新生成客户端与服务端辅助代码到 `output/` 目录

### 4.2 常用参数

`convert-xlsx-to-config.js` 支持以下参数：

- `--input`, `--in`, `-i`  
  输入目录或单一文件。  
  默认：`input/xlsx`（从当前目录执行时）。

- `--out-dir`  
  输出根目录。  
  默认：`output`（从当前目录执行时）。

- `--target`  
  生成目标：`server` | `client` | `both`  
  默认：`both`。

- `--pretty`  
  格式化 JSON 输出（默认 2 空格缩进）。

- `--minify`  
  JSON 最小化输出（无缩进）。

- `--language`, `--lang`  
  生成语言，逗号分隔。默认：`ts`。  
  示例：`--language ts,csharp`。

示例（均在本目录执行）：

```bash
# 使用默认输入与输出
node convert-xlsx-to-config.js

# 指定输入目录
node convert-xlsx-to-config.js --input ./input/xlsx

# 指定单个 xlsx 文件
node convert-xlsx-to-config.js --input ./input/xlsx/Hero.xlsx

# 仅生成服务端相关产物
node convert-xlsx-to-config.js --target server

# 仅生成客户端相关产物
node convert-xlsx-to-config.js --target client
```

> 提示：在当前仓库中，脚本内部会自动将工作目录切换到项目根目录，以兼容现有路径设置；
> 若将本目录抽取为独立包，一般直接在包根目录下执行，上述相对路径也会自然生效。

---

## 5. 作为独立 NPM 包使用

你可以将 ConfigForge 目录（`config-forge`）拷贝到其他项目中，依赖本目录下的 `package.json` 作为独立工具使用。

### 5.1 安装依赖

在目标项目中拷贝本目录后：

```bash
cd config-forge
npm install
```

会安装运行工具所需的最小依赖（见 `package.json`）。

### 5.2 使用 npm scripts

在本目录下提供了若干脚本命令：

```bash
# 同时生成 server 和 client 产物
npm run generate

# 仅生成 server
npm run generate:server

# 仅生成 client
npm run generate:client
```

上述命令实质上是对 `node convert-xlsx-to-config.js` 的简单封装。

如有需要，也可以在上层项目中通过 `npx` 或在 `package.json` 中增加自定义脚本，调用这里的 CLI。

---

## 6. 实现与依赖说明

- 所有脚本均为普通 Node.js（CommonJS）脚本，无需额外构建步骤。
- 运行时依赖包括：
  - `exceljs` —— 读取 `.xlsx` 文件
  - `fs-extra` —— 文件系统工具
  - `glob` —— 文件匹配
  - `chalk` —— 彩色控制台输出

主要生成逻辑位于：

- `convert-xlsx-to-config.js`
  - `parseConfigSheet`：解析配置 Sheet
  - `generateInterfaceCode`：根据表头与类型生成接口代码
  - `generateInterfacesIndexFile`：生成接口目录下的 `index.ts`
- `libs/templates/ts/generate-client-template.js`
  - 客户端 ConfigRegistry / ConfigAccessor / index.ts 的模板逻辑
- `libs/templates/ts/generate-server-template.js`
  - 服务端 Facade / business-types 的模板逻辑

如需调整命名规则或模板风格，请优先修改以上函数。

---

## 7. 示例

以下是一份简化的 CSV 示例，仅用于说明表头和数据格式（对应 `sample.csv`）：

```csv
MetaKey,MetaValue
TableName,Hero
JsonFileName,Hero.json
PrimaryKey,id
Description,英雄基础配置示例

编号【KEY】,头像ID,中文名,
id,modeId,cnName,
int,int,string,
server,server,server,
client,client,client,
1,1001,悟空,
2,1002,贝吉塔,
```

在实际的 XLSX 中，表头含义完全相同：

- `TableName` 用于生成接口名（如 `HeroDefinition`）
- 字段名（`id`, `modeId`, `cnName`）用于生成接口字段
- 显示名（如 `编号【KEY】`）会被写入字段注释中，用于辅助阅读。

---

## 8. 许可证

本目录通常作为更大项目的一部分使用，开源时应确保**根项目的许可证**也覆盖到此工具集。

如果将本目录抽取为独立的 NPM 包，可以选择与你项目一致的协议（例如 MIT）：

```text
MIT License

Copyright (c) YEAR AUTHOR

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

[...]
```
