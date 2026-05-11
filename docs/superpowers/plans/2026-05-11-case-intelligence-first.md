# 一人公司作战库 Case Intelligence First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the case intelligence library as the product core for 一人公司作战库, then wire the skill layer on top of it so product ideas can be answered with similar products, similar routes, bottlenecks, and China-specific risks.

**Architecture:** The system is a deterministic knowledge pipeline: `source-map` -> `raw cases` -> `normalized cases` -> `gold cases` -> `route index` -> skill prompts. The skill does not invent credibility; it retrieves from the library, compares against cases, and returns compact commercial judgment. Public web sources, manual seed sources, and user-submitted links all flow through the same schema and validation gate.

**Tech Stack:** Node.js 20+, JSONL, JSON Schema, Markdown knowledge packs, npm scripts, optional future crawlers for public web sources.

---

## Workspace

Root: `C:\Users\PC\Desktop\skill_The_book_of_Elon`

Source spec: `docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md`

Safety rule: do not delete any existing server runtime, live deployment config, or unrelated repo file. This plan only touches the local skill/data assets and validation scripts inside this repo.

---

## File Structure

Create:

- `knowledge/cases/README.md`
- `knowledge/cases/source-map.jsonl`
- `knowledge/cases/raw/raw-cases.jsonl`
- `knowledge/cases/normalized/normalized-cases.jsonl`
- `knowledge/cases/gold/gold-cases.jsonl`
- `knowledge/cases/indexes/case-route-index.json`
- `knowledge/cases/schema/source.schema.json`
- `knowledge/cases/schema/raw-case.schema.json`
- `knowledge/cases/schema/normalized-case.schema.json`
- `knowledge/cases/schema/gold-case.schema.json`
- `knowledge/evals/product-idea-queries.md`
- `scripts/opc/validate-case-intelligence.js`
- `scripts/opc/build-case-index.js`
- `tests/opc/case-intelligence-validator.test.js`

Modify:

- `package.json`
- `docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md`
- `docs/superpowers/plans/2026-05-11-one-person-company-skill-system.md`

Later phase only:

- `skills/*/SKILL.md`
- future adapter scripts for public-web ingestion

---

### Task 1: Lock The Data Model

**Files:**

- Create: `knowledge/cases/schema/source.schema.json`
- Create: `knowledge/cases/schema/raw-case.schema.json`
- Create: `knowledge/cases/schema/normalized-case.schema.json`
- Create: `knowledge/cases/schema/gold-case.schema.json`
- Create: `knowledge/cases/README.md`

- [ ] **Step 1: Write the exact schemas**

Use these field contracts:

```json
// source.schema.json
{
  "required": ["id", "name", "url", "platform", "language", "priority", "access", "collection_method", "allowed_use", "risk_level", "notes"],
  "idPattern": "^src_[a-z0-9_]+$",
  "riskLevels": ["low", "medium", "high"]
}
```

```json
// raw-case.schema.json
{
  "required": ["id", "source_id", "url", "title", "captured_at", "language", "raw_signal", "evidence_type", "rights_note"],
  "idPattern": "^raw_[a-z0-9_]+$",
  "rawSignalMaxLength": 600
}
```

```json
// normalized-case.schema.json
{
  "required": ["id", "raw_ids", "name", "founder_type", "geography", "target_user", "product_form", "route", "acquisition", "delivery", "pricing", "evidence_urls", "summary", "commercial_path", "risks", "confidence", "date_checked"],
  "idPattern": "^case_[a-z0-9_]+$",
  "confidenceValues": ["low", "medium", "high"]
}
```

```json
// gold-case.schema.json
{
  "required": ["id", "case_id", "score", "why_gold", "reusable_lessons", "applicable_to", "warning_flags"],
  "idPattern": "^gold_[a-z0-9_]+$",
  "scoreRange": [0, 100]
}
```

- [ ] **Step 2: Write the library README**

Use this content:

```md
# 一人公司作战库 - 情报库

这个目录保存的是一人公司案例情报，不是文章摘录仓库。

## 分层

- `source-map.jsonl`: 数据源目录
- `raw/raw-cases.jsonl`: 原始线索
- `normalized/normalized-cases.jsonl`: 标准化案例
- `gold/gold-cases.jsonl`: 高价值样本
- `schema/*.json`: 每层数据约束

## 规则

- 只保存公开可访问来源的元数据、短摘要、结构化事实和我们的判断
- 不存长篇转载，不存大段正文
- 每条 normalized case 必须能回溯到 raw case
- 每条 gold case 必须能回溯到 normalized case

## 目标

- 1000 条 raw source / raw case
- 300 条 normalized case
- 50 条 gold case
```

- [ ] **Step 3: Verify the files exist**

Run:

```bash
node -e "const fs=require('fs'); ['knowledge/cases/README.md','knowledge/cases/schema/source.schema.json','knowledge/cases/schema/raw-case.schema.json','knowledge/cases/schema/normalized-case.schema.json','knowledge/cases/schema/gold-case.schema.json'].forEach(p=>{if(!fs.existsSync(p)) throw new Error('missing '+p)}); console.log('ok')"
```

Expected: `ok`

---

### Task 2: Seed The Case Library

**Files:**

- Create: `knowledge/cases/source-map.jsonl`
- Create: `knowledge/cases/raw/raw-cases.jsonl`
- Create: `knowledge/cases/normalized/normalized-cases.jsonl`
- Create: `knowledge/cases/gold/gold-cases.jsonl`

- [ ] **Step 1: Add source-map entries**

Seed the first source buckets:

- `src_qiit_cases`
- `src_microsaas_zone`
- `src_opcbase_cases`
- `src_indiehackers_stories`
- `src_solostory`
- `src_singlefoundercompany_cases`
- `src_starterstory`
- `src_producthunt`
- `src_hunted_space_history`
- `src_awesome_indiehackers`
- `src_awesome_indie`
- `src_dbskill`
- `src_sspai_90756`
- `src_sspai_104539`
- `src_geekpark_xhs_indie`
- `src_jiemian_xhs_indie_stats`
- `src_feelscoder_production`
- `src_reddit_saas`
- `src_reddit_sideproject`
- `src_wechat_public_accounts`
- `src_zhihu_public_search`
- `src_xiaohongshu_public_search`
- `src_jike_public_search`
- `src_douyin_public_search`

Use the existing source-map file already created in this workspace as the seed. Keep the fields stable and avoid adding unsupported columns.

- [ ] **Step 2: Add the first raw cases**

Seed at least one raw case for each of these patterns:

- revenue/ARR/MRR case
- feature-limitation positioning case
- content-to-product case
- Xiaohongshu cold-start case
- China ecosystem signal case

Keep the raw signal short. Store the article title, URL, date, and a one-sentence signal, not copied body text.

- [ ] **Step 3: Normalize the first cases**

Every normalized case must include:

- `raw_ids`
- `founder_type`
- `target_user`
- `product_form`
- `route`
- `acquisition`
- `delivery`
- `pricing`
- `summary`
- `commercial_path`
- `risks`
- `confidence`

The normalized layer should answer: what it is, who buys, how it grows, where it breaks.

- [ ] **Step 4: Curate gold cases**

Promote only cases that clearly show one or more of:

- narrow scope beating broad scope
- service-to-product transition
- domestic channel leverage
- real route clarity
- real commercial constraint

---

### Task 3: Add Deterministic Validation

**Files:**

- Create: `scripts/opc/validate-case-intelligence.js`
- Create: `tests/opc/case-intelligence-validator.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing validator test**

Test these behaviors:

- a valid fixture with 1 source / 1 raw / 1 normalized / 1 gold passes
- a normalized case that points to a missing raw id fails
- the script reports counts and errors deterministically

- [ ] **Step 2: Make the validator pass the fixture**

Implement:

- JSONL reader
- required field checks
- ID uniqueness checks
- raw -> source reference checks
- normalized -> raw reference checks
- gold -> normalized reference checks
- count checks

- [ ] **Step 3: Add npm scripts**

Add these scripts:

```json
{
  "opc:validate:cases": "node scripts/opc/validate-case-intelligence.js --target=v0.1",
  "opc:validate:cases:smoke": "node scripts/opc/validate-case-intelligence.js",
  "opc:case:index": "node scripts/opc/build-case-index.js"
}
```

- [ ] **Step 4: Run validator tests**

Run:

```bash
node tests/opc/case-intelligence-validator.test.js
```

Expected: `case-intelligence-validator tests passed`

Run:

```bash
node scripts/opc/validate-case-intelligence.js --target=v0.1
```

Expected: fail until the library reaches the target counts

---

### Task 4: Build Route Indexing

**Files:**

- Create: `scripts/opc/build-case-index.js`
- Create: `knowledge/cases/indexes/case-route-index.json`

- [ ] **Step 1: Write the route index builder**

The builder should read `normalized/normalized-cases.jsonl` and group cases by `route`.

Output shape:

```json
{
  "generated_at": "ISO timestamp",
  "route_count": 3,
  "routes": {
    "content_to_paid_template": [
      {
        "id": "case_x",
        "name": "Example",
        "target_user": ["..."],
        "product_form": ["..."],
        "acquisition": ["..."],
        "pricing": ["..."],
        "confidence": "medium"
      }
    ]
  }
}
```

- [ ] **Step 2: Run the builder**

Run:

```bash
node scripts/opc/build-case-index.js
```

Expected: `wrote N routes`

- [ ] **Step 3: Verify the output file exists**

Expected file:

```bash
knowledge/cases/indexes/case-route-index.json
```

---

### Task 5: Add Product-Idea Evaluation Prompts

**Files:**

- Create: `knowledge/evals/product-idea-queries.md`

- [ ] **Step 1: Write the evaluation queries**

Include at least five product ideas:

- one domestic freelancer tool
- one AI content tool
- one B2B automation product
- one solo developer subscription app
- one Xiaohongshu-driven consumer app

- [ ] **Step 2: Define the expected output**

Every answer must include:

- at least 3 similar products or cases
- at least 2 similar commercial routes
- 1 most likely business bottleneck
- 1 shortest validation path
- 1 China-specific risk

- [ ] **Step 3: Reuse the queries for later skill eval**

This file becomes the evaluation harness for prompt quality once the skill layer is wired up.

---

### Task 6: Reframe The Existing Skill Plan

**Files:**

- Modify: `docs/superpowers/plans/2026-05-11-one-person-company-skill-system.md`

- [ ] **Step 1: Mark the old plan as superseded**

Add a short note near the top:

```md
> Superseded by `2026-05-11-case-intelligence-first.md`. Kept only for historical skill-layer reference.
```

- [ ] **Step 2: Remove the skill-first ordering as the primary narrative**

Do not delete the file. Keep it as reference only so the repo history remains readable.

- [ ] **Step 3: Make sure the data-first plan is the default execution path**

The new plan should be the one future workers follow.

---

### Task 7: Verification Before Completion

**Files:**

- All files above

- [ ] **Step 1: Run the validator test**

Run:

```bash
node tests/opc/case-intelligence-validator.test.js
```

- [ ] **Step 2: Run the library validator**

Run:

```bash
node scripts/opc/validate-case-intelligence.js --target=v0.1
```

Expected: fail until the corpus reaches target counts

- [ ] **Step 3: Run the index builder**

Run:

```bash
node scripts/opc/build-case-index.js
```

- [ ] **Step 4: Run a diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace or patch-format errors

---

## Self-Review

Coverage:

- data model: covered by Task 1
- seed library: covered by Task 2
- deterministic validation: covered by Task 3
- route index: covered by Task 4
- eval prompts: covered by Task 5
- plan supersession: covered by Task 6
- verification: covered by Task 7

Placeholder scan:

- no TBD/TODO markers
- no vague validation step
- no undefined functions referenced without file paths

