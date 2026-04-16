# Config Spreadsheet CSV / XLSX Specification

> Scope: configuration spreadsheets (produced by designers) that are automatically converted into JSON and TypeScript interfaces.
>
> Goals:
> - Allow designers to edit configs with **Chinese file names and column headers**;
> - Use a small set of conventions so the tool can infer table name, output JSON filename, field name, type, and server/client visibility;
> - Use **XLSX** as the only source for JSON/interface generation, while CSV is only for export/backup.

---

## 1. File-level rules

### 1.1 File name

- **File names can be any Chinese/English names**, mainly for designers:
  - Examples: `英雄基础配置.xlsx`, `动作配置.xlsx`.
- **The output JSON filename does not depend on the XLSX filename** and is defined by in-table metadata (see section 4).

### 1.2 Worksheets (Sheets)

- Config sheets: each config sheet corresponds to one config table.
- Recommended: sheet name matches the normalized table name:
  - Examples: `Hero`, `Action`, `CoachUpgrade`.
- Reserve an extra sheet named `__meta__` to store metadata for all tables (table name, JSON filename, primary key, etc.). See section 4.
- One XLSX can contain multiple config sheets plus one `__meta__` sheet.

> CSV has no sheet concept. Treat it as a single-table file used only for export/view/backup. It does not participate in JSON/interface generation.

---

## 2. Header structure (first 5 rows)

Each table uses the **first 5 rows** to describe field metadata. Data starts from row 6.

### Row 1: Display name (Chinese name + key/index markers)

- Human-readable column title for designers/art.
- Can include Chinese text, spaces, parentheses, etc.
- Supports markers in the display name, for example:
  - `编号[PK]` or `编号【PK】` marks a primary key.
  - Markers like `【UNIQUE】`, `【INDEX】` can be extended if needed.

**Parsing recommendations:**

- Use regex to extract markers like `[PK]` / `【PK】`. The remaining Chinese text is only used as comments and does not affect logic.
- The primary key field is written into generated meta info (`primaryKey`).

### Row 2: Field name

- Field name used in JSON / TypeScript interface.
- Requirements:
  - Use camelCase or the project convention, e.g. `id`, `modeId`, `cnName`.
  - Must be unique, no duplicates.
  - Only allow safe characters (letters, numbers, underscore).

**Usage in generation:**

- JSON key: `{ "id": 1, "modeId": 116, "cnName": "悟空" }`
- TS interface field: `id: number; modeId: number; cnName: string;`

### Row 3: Field type (Type)

- Describes field data types for interface generation and reverse JSON conversion.
- Recommended type markers:
  - Primitive types:
    - `int` / `integer` → TS: `number`
    - `float` / `double` → TS: `number`
    - `string` → TS: `string`
    - `bool` / `boolean` → TS: `boolean`
    - `date` → TS: `string` (or project-specific type)
    - `datetime` → TS: `string`
  - Array types:
    - `int[]`, `float[]`, `string[]`, `bool[]` → TS: `number[]`, `string[]`, `boolean[]` etc.
  - Complex types:
    - `json`, `object` → TS: `any` or project-specific type; values are typically stored as JSON strings.

**Usage in generation:**

- Infer interface types:
  - `int` → `number`
  - `string[]` → `string[]`
- During XLSX → JSON, types may be converted (e.g. converting string "7" to number `7`).

### Row 4: Server scope

- Each column indicates whether the field is visible to the **server**.
- Recommended values:
  - `server` / `S` / `1`: server-visible.
  - Empty or `-`: not needed on server.

**Usage in generation:**

- Server JSON:
  - Only export fields marked as `server`.
- Server interface:
  - Only include server-visible fields.

> You may support a `both` value, but keeping separate server/client rows is more explicit for designers.

### Row 5: Client scope

- Each column indicates whether the field is visible to the **client**.
- Recommended values:
  - `client` / `C` / `1`: client-visible.
  - Empty or `-`: not needed on client.

**Usage in generation:**

- Client JSON / config code:
  - Only export fields marked as `client`.
- Client interface (for example, Zustand store types):
  - Only include client-visible fields.

---

## 3. Data area (from row 6)

- Rows from 6 onwards are data rows. Each row is one config record.
- Fill values according to the field type:
  - `int` / `float`: numeric values, e.g. `7`, `116`, `100.5`.
  - `string`: text values, e.g. `悟空`, `A队`.
  - `int[]` / `string[]` array types:
    - Use a consistent separator (e.g. comma `,`): `1,2,3`.
    - The tool splits into arrays by comma.
  - `json` / `object`:
    - Use JSON string or a project-agreed token; tool handles according to convention.

**Notes:**

- Avoid non-numeric characters in numeric fields.
- Avoid meaningless spaces. The tool can trim, but do not rely on it.

---

## 4. Table-level metadata (XLSX only): table name vs JSON filename

In XLSX, designers can use Chinese file names and sheet names. The tool uses a dedicated `__meta__` sheet to map table name, JSON filename, and primary key.

### 4.1 `__meta__` sheet structure

- Reserve a sheet named `__meta__` in the same XLSX file.
- Row 1 is the header. Each subsequent row describes a table.
- Recommended structure:

```text
SheetName,TableName,JsonFileName,PrimaryKey,Description
Hero,Hero,Hero.json,id,英雄基础配置表
Action,Action,Action.json,id,动作配置
```

Field meanings:

- `SheetName`: name of the config sheet (e.g. `Hero`). This is the primary key for metadata lookup.
- `TableName`: normalized table name, used for:
  - TypeScript interface: `HeroDefinition`, `HeroMeta`.
  - Code access: `ConfigLoader.loadConfig('Hero')`.
  - If empty, defaults to `SheetName`.
- `JsonFileName`: output JSON filename:
  - Typically `<TableName>.json`, e.g. `Hero.json`.
  - If empty, defaults to `<TableName>.json`.
- `PrimaryKey`: primary key field name:
  - If empty, the tool may default to `id`.
- `Description`: optional description for docs/logs only.

> Tool rules:
> - Only **XLSX + `__meta__` sheet** participate in JSON/interface generation.
> - CSV does not participate; it is only for export/view/backup.

---

## 5. CSV vs XLSX recommendations

### 5.1 Encoding and display

- CSV:
  - Export with **UTF-8 + BOM** to avoid garbled Chinese text in Windows Excel.
  - If values contain commas, newlines, or quotes, escape by CSV rules (wrap with quotes and replace `"` with `""`).
  - Use only for export/view/backup, not as input for generation.
- XLSX:
  - Native UTF-8 support, no BOM needed.
  - Recommended for daily editing and as the source for JSON/interface generation.

### 5.2 Multi-table management (XLSX only)

- A single XLSX can contain multiple config tables. Each table has its own 5-row header and data area, plus a shared `__meta__` sheet for metadata.

---

## 6. Example: Hero table (simplified)

A normalized example based on `test.csv` (text-only format):

```csv
编号[PK],头像ID,中文名,
id,modeId,cnName,
int,int,string,
server,server,server,
client,client,client,
1,1001,悟空,
2,1002,贝吉塔,
```

Meaning:

- Row 1:
  - `编号[PK]`: primary key field with display name “编号”.
  - `头像ID`: display name.
  - `中文名`: display name.
- Row 2:
  - `id`, `modeId`, `cnName`: field names.
- Row 3:
  - `int`, `int`, `string`: field types.
- Row 4:
  - `server`: server-visible.
- Row 5:
  - `client`: client-visible.
- Row 6+:
  - data rows.

Recommended metadata (as a small table):

```csv
MetaKey,MetaValue
TableName,Hero
JsonFileName,Hero.json
Description,英雄基础配置表
```

---

## 7. Suggested future tool support

Based on this spec, the tooling can support:

1. **JSON → CSV/XLSX**:
   - Generate full header rows from existing JSON and interfaces for designer editing.
   - Auto-fill primary key markers, type row, server/client flags, and metadata sheet.

2. **XLSX (with `__meta__`) → JSON + interface**:
   - Read field names and types from headers and generate TypeScript interfaces.
   - Read `SheetName` / `TableName` / `JsonFileName` / `PrimaryKey` from `__meta__` and generate JSON files and meta.
   - Generate scoped server/client outputs based on the server/client rows.

3. **Validation tools**:
   - Validate required fields.
   - Validate type correctness (e.g. non-numeric values in `int[]`).
   - Validate server/client markers (`server`/`client`/empty).

This document is the shared contract between design and engineering. If you extend the rules (e.g. platform/region variants), update this spec accordingly.
