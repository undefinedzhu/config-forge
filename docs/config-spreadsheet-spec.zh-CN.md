# 配置表 CSV / XLSX 规范

> 适用范围：`config` 相关表格（策划产出），用于自动转换为 JSON 和 TypeScript interface。
>
> 目标：
> - 让策划可以用**中文文件名和列名**编辑配置；
> - 通过少量约定，让工具自动知道：表名、输出 JSON 文件名、字段名、类型、server/client 可见性；
> - 以 **XLSX** 作为参与 JSON / interface 生成的唯一来源，CSV 仅作导出/备份使用。

---

## 1. 文件级规范

### 1.1 文件名

- **文件名可以是任意中文/英文名称**，主要面向策划：
  - 例如：`英雄基础配置.xlsx`、`动作配置.xlsx`。
- **最终导出的 JSON 文件名不依赖文件名**，而是由表内元数据指定（见下文 4）。

### 1.2 工作表（Sheet）

- 配置用 Sheet：每个配置 Sheet 对应一张配置表。
- 推荐 Sheet 名与规范化表名一致：
  - 例如：`Hero`、`Action`、`CoachUpgrade`。
- 额外保留一个名为 `__meta__` 的 Sheet，用于存放所有配置表的元数据（表名、JSON 文件名、主键等），见下文第 4 节。
- 一个 XLSX 文件可以包含多张配置表（多个 Sheet）+ 1 个 `__meta__` Sheet。

> CSV 没有 Sheet 概念，可视为单表文件，仅用于导出/查看/备份，不参与 JSON/interface 生成流程。

---

## 2. 表头结构（前 5 行）

每张表的**前 5 行**用于描述字段元信息，从第 6 行开始是数据。

### 行 1：显示名（中文名 + 主键/索引标记）

- 面向策划/美术的可读列名。
- 可以包含中文、空格、括号等。
- 支持在显示名中标记主键、索引等，例如：
  - `编号[PK]` 或 `编号【PK】` 表示主键（Primary Key）。
  - 可扩展 `【UNIQUE】`、`【INDEX】` 等标记（工具可按需识别）。

**解析规则建议：**

- 工具用正则提取 `[PK]` / `【PK】` 等特殊标记，剩余中文只作为注释使用，不影响逻辑。
- 主键字段会写入生成的 Meta 信息（`primaryKey`）。

### 行 2：字段名（Field Name）

- 对应 JSON / TypeScript interface 的字段名。
- 要求：
  - 使用 camelCase 或项目约定的命名方式，例如：`id`, `modeId`, `cnName`。
  - 必须唯一，不允许重复。
  - 仅允许字母、数字、下划线等安全字符。

**生成时用途：**

- JSON key：`{ "id": 1, "modeId": 116, "cnName": "悟空" }`
- TS interface 字段：`id: number; modeId: number; cnName: string;`

### 行 3：字段类型（Type）

- 用于描述字段的数据类型，便于生成 interface 和反向 JSON 转换。
- 推荐类型标记：
  - 基础类型：
    - `int` / `integer` → 对应 TS: `number`
    - `float` / `double` → TS: `number`
    - `string` → TS: `string`
    - `bool` / `boolean` → TS: `boolean`
    - `date` → TS: `string`（或项目约定类型）
    - `datetime` → TS: `string`
  - 数组类型：
    - `int[]`, `float[]`, `string[]`, `bool[]` → TS: `number[]`, `string[]`, `boolean[]` 等
  - 复杂类型：
    - `json`, `object` → TS: `any` 或项目自定义类型；值一般保存为 JSON 字符串。

**生成时用途：**

- 推导 interface 类型：
  - `int` → `number`
  - `string[]` → `string[]`
- 在 XLSX → JSON 时，可选择做类型转换（例如将字符串 `"7"` 转为数字 `7`）。

### 行 4：Server 可用性（Server Scope）

- 每一列标记该字段是否对 **服务端** 可见。
- 建议取值：
  - `server` / `S` / `1`：服务端可用。
  - 空字符串或 `-`：服务端不需要该字段。

**生成时用途：**

- 生成 server 端 JSON：
  - 只导出标记为 `server` 的字段。
- 生成 server 端 interface：
  - 只包含 server 可见的字段。

> 也可以选择让工具支持 `both`，但建议将 server/client 拆成两行，策划一眼就能看懂。

### 行 5：Client 可用性（Client Scope）

- 每一列标记该字段是否对 **客户端** 可见。
- 建议取值：
  - `client` / `C` / `1`：客户端可用。
  - 空字符串或 `-`：客户端不需要该字段。

**生成时用途：**

- 生成 client 端 JSON / 配置代码：
  - 只导出标记为 `client` 的字段。
- 生成 client 端类型定义（例如 Zustand store 的类型）：
  - 只包含 client 可见的字段。

---

## 3. 数据区（第 6 行开始）

- 从第 6 行起为正式数据，每一行是一条配置记录。
- 各列按照字段类型规则填写对应的值：
  - `int` / `float`：直接写数字，例如 `7`, `116`, `100.5`。
  - `string`：直接写文本，例如 `悟空`、`A队`。
  - `int[]` / `string[]` 等数组类型：
    - 建议统一分隔符（例如英文逗号 `,`）：`1,2,3`。
    - 工具解析时按逗号拆分为数组。
  - `json` / `object`：
    - 直接写 JSON 字符串或关键标识，工具按约定处理。

**注意事项：**

- 避免在数值字段中混入非数字字符。
- 避免无意义的空格；工具可以做 `trim`，但不建议依赖。

---

## 4. 表级元数据（仅 XLSX）：表名与 JSON 文件名解耦

在 XLSX 中，策划可以用中文文件名和 Sheet 名，工具通过专用的 `__meta__` Sheet 知道每张表的 `tableName`、JSON 文件名和主键等信息。

### 4.1 `__meta__` Sheet 结构

- 在同一个 XLSX 文件中保留一个名为 `__meta__` 的 Sheet。
- 第 1 行是表头，后续每一行为一张配置表的元数据。
- 推荐结构如下：

```text
SheetName,TableName,JsonFileName,PrimaryKey,Description
Hero,Hero,Hero.json,id,英雄基础配置表
Action,Action,Action.json,id,动作配置
```

字段含义：

- `SheetName`：配置表所在 Sheet 的名称（例如 `Hero`）。这是查找元数据的主键。
- `TableName`：规范化表名，用于：
  - TypeScript interface：`HeroDefinition`, `HeroMeta`。
  - 代码中访问：`ConfigLoader.loadConfig('Hero')`。
  - 若为空，默认等于 `SheetName`。
- `JsonFileName`：最终导出的 JSON 文件名：
  - 一般为 `<TableName>.json`，例如 `Hero.json`。
  - 若为空，默认使用 `<TableName>.json`。
- `PrimaryKey`：主键字段名：
  - 若为空，工具可按约定默认使用 `id`。
- `Description`：可选说明，仅供文档/日志使用。

> 工具侧：
> - 业务流程中 **仅使用 XLSX + `__meta__` Sheet** 参与 JSON/interface 生成；
> - CSV 不参与 JSON/interface 生成，仅作为导出/查看/备份格式。

---

## 5. CSV 与 XLSX 的差异和建议

### 5.1 编码与显示

- CSV：
  - 工具导出时应使用 **UTF-8 + BOM**，确保 Excel 在 Windows 下打开中文不乱码。
  - 字段值包含逗号、换行、双引号时，需要按 CSV 规范进行转义（用双引号包裹，并将内部 `"` 替换为 `""`）。
  - 仅用于导出、查看和备份，不作为 JSON/interface 生成的输入源。
- XLSX：
  - 原生支持 UTF-8，不存在 BOM 问题。
  - 推荐用于策划日常编辑和参与 JSON/interface 生成。

### 5.2 多表管理（仅 XLSX）

- 一个 XLSX 文件可以包含多张配置表，每张表都有自己的 5 行表头和数据区域，再加 1 个集中存放元数据的 `__meta__` Sheet。

---

## 6. 示例：Hero 表（简化版）

以 `test.csv` 的结构为基础的规范化示例（用文本形式展示）：

```csv
编号[PK],头像ID,中文名,
id,modeId,cnName,
int,int,string,
server,server,server,
client,client,client,
1,1001,悟空,
2,1002,贝吉塔,
```

对应含义：

- 行 1：
  - `编号[PK]`：主键字段，中文名“编号”。
  - `头像ID`：中文说明。
  - `中文名`：中文说明。
- 行 2：
  - `id`, `modeId`, `cnName`：字段名。
- 行 3：
  - `int`, `int`, `string`：字段类型。
- 行 4：
  - `server`：三列对服务端可见。
- 行 5：
  - `client`：三列对客户端可见。
- 行 6+：
  - 实际数据行。

元数据（推荐单独小表）：

```csv
MetaKey,MetaValue
TableName,Hero
JsonFileName,Hero.json
Description,英雄基础配置表
```

---

## 7. 未来工具支持方向（建议）

基于上述规范，工具层可以支持：

1. **JSON → CSV/XLSX**：
   - 根据现有 JSON 和 interface 生成带完整头部信息的表格，便于策划编辑。
   - 自动填充：主键标记、类型行、server/client 标记、元数据表。

2. **XLSX（含 `__meta__` Sheet） → JSON + interface**：
   - 从各配置 Sheet 的表头读取字段名 & 类型，生成 TypeScript interface。
   - 从 `__meta__` Sheet 读取 `SheetName` / `TableName` / `JsonFileName` / `PrimaryKey`，生成对应 JSON 文件和 Meta。
   - 根据 server/client 行生成服务端/客户端裁剪版配置。

3. **校验工具**：
   - 校验必填字段是否存在。
   - 校验类型是否有效（例如 `int[]` 中是否包含非数字）。
   - 校验 server/client 标记是否符合预设值（`server`/`client`/空）。

此文档作为策划与工程之间的约定基础，后续如果你调整规则（例如增加“平台维度”、“地区服差异”等），可以在此文档上继续扩展约定。 
