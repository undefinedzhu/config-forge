# ConfigForge (XLSX → JSON & TypeScript Interfaces)

ConfigForge is an **open-source, spreadsheet-driven configuration pipeline** that converts design XLSX files into:

- Server / client JSON data files
- TypeScript interface definitions
- Client / server helper code (ConfigRegistry / ConfigAccessor / Facade)

It is designed to be usable as a **standalone package** or embedded into larger codebases, with a clear, repeatable build flow.

> All generated files are build artifacts. Do not edit generated code by hand.

---

## 0. Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Place your spreadsheets in `input/xlsx`.
3. Generate artifacts:
   ```bash
   node convert-xlsx-to-config.js
   ```
4. Check outputs in `output/client` and `output/server`.

---

## 1. Features

- **XLSX → JSON**
  - Read one or more `.xlsx` files from an input directory
  - Generate server / client scoped JSON files
- **XLSX → TypeScript interfaces**
  - Generate per-table `*.interface.ts` using a unified naming convention
  - Generate `index.ts` barrels for easier imports
  - Use spreadsheet display names as inline field comments
- **Helper code generation**
  - Client side: `ConfigRegistry.ts`, `ConfigAccessor.ts`, and `index.ts`
  - Server side: Facade class (`game-config.facade.ts`) and `business-types.ts`
- **Incremental generation & cache**
  - XLSX hashing with cache records in `output/.cache.json`
  - Skip unchanged files to speed up large projects
- **JSON output formatting**
  - `--pretty` for formatted JSON (default)
  - `--minify` for compact JSON output
- **Modular core & plugins**
  - Core modules: parser / validator / generator / io / cache
  - Template generation runs via plugin pipeline
- **C# model generation**
  - Generates C# config models into `output/client-csharp`
- **Friendly CLI & logs**
  - Clear, scoped console output with `[Client]` / `[Server]` prefixes
  - Designed to be safe to run repeatedly during development

---

## 2. Spreadsheet Specification

The tools follow the **config-spreadsheet-spec** used in this project.

Each XLSX file:

- May contain multiple **config sheets** (one per logical table)
- Optionally contains a `__meta__` sheet that describes each table

Each config sheet uses a **5-row header** followed by data rows:

1. **Display Name** (用于生成注释的中文/显示名，例如 `编号【KEY】`)
2. **Field Name** (代码中的字段名，例如 `id`)
3. **Type** (如 `int`, `string`, `bool`, `int[]` 等)
4. **Server Flag** (`server` / 空) — 是否对服务器可见
5. **Client Flag** (`client` / 空) — 是否对客户端可见

Data rows start from row 6.

When a `__meta__` sheet is present, it should describe each table with at least:

- `SheetName` – the name of the worksheet
- `TableName` – logical table name (PascalCase)
- `JsonFileName` – output JSON file name (e.g. `Hero.json`)
- `PrimaryKey` – primary key field name (e.g. `id`)
- `Description` – human friendly description

If `__meta__` is missing, the tool will infer table metadata directly from the sheets.

For more details, see `config-spreadsheet-spec.md` in this directory.

---

## 3. Directory Layout

Within the ConfigForge directory (`config-forge`):

- `convert-xlsx-to-config.js`
  - Main CLI entry to convert XLSX → JSON & TS interfaces and then run template generators
- `libs/templates/ts/generate-client-template.js`
  - Client-side helper code generation (ConfigRegistry / ConfigAccessor / index.ts)
- `libs/templates/ts/generate-server-template.js`
  - Server-side helper code generation (Facade / business-types)
- `libs/templates/csharp/generate-csharp-template.js`
  - C# model generation (config table classes)
- `libs/core/`
  - Core modules: parser / validator / generator / io / cache
- `libs/generator-plugins.js`
  - Template generator plugin pipeline
- `input/xlsx/`
  - Default XLSX input directory (each `.xlsx` is a bundle of tables)
- `output/`
  - Default output root for all generated artifacts
  - Includes `output/.cache.json` for incremental builds

The default output structure is:

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

All of these paths are configurable via CLI arguments or options when calling the generator functions directly.

---

## 3.1 JSON → Table Helper (convert-json-to-table.js)

In addition to the XLSX → JSON pipeline, this folder also contains a **reverse helper**:

- `convert-json-to-table.js`
  - Reads runtime JSON data (for example `libs/game-config/src/data/*.json`).
  - Only processes files where the top-level value is an array of objects.
  - Merges all object keys to build a header row.
  - Exports per-file `.csv` and/or `.xlsx` into a specified output directory.

The generated **XLSX** files follow the same 5-row header + `__meta__` convention as
`convert-xlsx-to-config.js`, so you can:

- Export existing JSON → XLSX
- Open and edit the tables in a spreadsheet tool
- Feed the updated XLSX back into `convert-xlsx-to-config.js` to regenerate JSON/interfaces

Typical usage (from the project root of ConfigForge):

```bash
node convert-json-to-table.js

# Export only XLSX
node convert-json-to-table.js --format xlsx

# Export CSV and XLSX
node convert-json-to-table.js --format csv,xlsx

# Export into config-forge/input so XLSX can be consumed by convert-xlsx-to-config.js
node convert-json-to-table.js --out-dir input
```

This helper is especially useful when you already have stable JSON config but want to
bootstrap spreadsheet-based authoring.

---

## 4. CLI Usage (from this folder)

The main entry point is `convert-xlsx-to-config.js`.

### 4.1 Run via Node

From the ConfigForge folder (`config-forge`):

```bash
node convert-xlsx-to-config.js
```

This will:

- Read all `.xlsx` files from `input/xlsx`
- Generate **both** server and client JSON & interfaces
- Regenerate client & server helper code in `output/`

### 4.2 CLI Options

`convert-xlsx-to-config.js` accepts the following flags:

- `--input`, `--in`, `-i`  
  Input directory or single file.  
  Default: `input/xlsx`.

- `--out-dir`  
  Output root directory.  
  Default: `output`.

- `--target`  
  Which side to generate: `server` | `client` | `both`  
  Default: `both`.

- `--pretty`  
  Pretty JSON output with 2-space indentation (default).

- `--minify`  
  Minified JSON output (spaces = 0).

- `--language`, `--lang`  
  Output language(s), comma-separated. Default: `ts`.  
  Example: `--language ts,csharp`.

Examples (from this folder):

```bash
# Use default input and output directories
node convert-xlsx-to-config.js

# Specify an input directory
node convert-xlsx-to-config.js --input ./input/xlsx

# Specify a single xlsx file
node convert-xlsx-to-config.js --input ./input/xlsx/Hero.xlsx

# Only generate server side artifacts
node convert-xlsx-to-config.js --target server

# Only generate client side artifacts
node convert-xlsx-to-config.js --target client
```

> Note: inside this repository, the script automatically changes the working directory to the project root so existing paths continue to work. When used as a standalone package, you typically run it from the package root and keep paths relative to that folder.

---

## 5. Using as a Standalone Package

When extracted as a standalone package, you can use the provided `package.json` to run the tools via `npm` / `npx`.

### 5.1 Installation (in another project)

Copy the ConfigForge folder (`config-forge`) into your project, then:

```bash
cd config-forge
npm install
```

This will install the minimal dependencies required to run the scripts (see `package.json`).

### 5.2 NPM Scripts

You can use the following scripts from this folder:

```bash
# Generate both server & client artifacts
npm run generate

# Only server
npm run generate:server

# Only client
npm run generate:client
```

Under the hood, these scripts call `node convert-xlsx-to-config.js` with the appropriate `--target` flag.

---

## 6. Development Notes

- The scripts are written in plain Node.js (CommonJS) and do not require a build step.
- External dependencies (runtime):
  - `exceljs` – reading `.xlsx` files
  - `fs-extra` – filesystem utilities
  - `glob` – file pattern matching
  - `chalk` – colored console output
- The code avoids sharing internal helpers across unrelated modules unless necessary, to keep coupling low.

If you need to adjust naming conventions or templates, look at:

- `config-forge/convert-xlsx-to-config.js`
  - `generateInterfaceCode`
  - `generateInterfacesIndexFile`
- `config-forge/libs/templates/ts/generate-client-template.js`
- `config-forge/libs/templates/ts/generate-server-template.js`

---

## 7. Sample

A minimal CSV-style sheet (for documentation) might look like:

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

In XLSX form, the same header semantics apply. The generated interface will use `TableName` (e.g. `Hero`) and field names (`id`, `modeId`, `cnName`), with display names (如 `编号【KEY】`) preserved as comments.

---

## 8. License

This folder is designed to be embedded in a larger project. When open-sourcing, you should ensure your **root project license** also applies to this tooling.

If you extract this directory as a separate package, choose a license that matches your project (for example, MIT):

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
