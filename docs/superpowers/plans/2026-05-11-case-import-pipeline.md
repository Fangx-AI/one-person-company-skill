# Case Import Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal local pipeline that imports candidate one-person-company cases into the raw and normalized case library without hand-editing multiple JSONL files.

**Architecture:** Add one focused importer script under `scripts/opc` that reads candidate JSONL, validates required fields, prevents duplicate IDs and URLs, appends raw and normalized rows, and can rebuild the route index afterward through existing scripts. Tests use temporary fixture repositories so production data is not mutated during test runs.

**Tech Stack:** Node.js CommonJS, JSONL files, existing case validator and route-index builder.

---

### Task 1: Importer Behavior Tests

**Files:**
- Create: `tests/opc/case-importer.test.js`
- Modify: none
- Test: `node tests/opc/case-importer.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/opc/case-importer.test.js` with tests that:
- create a temporary case library fixture,
- import one candidate and assert raw plus normalized rows are written,
- reject a duplicate evidence URL,
- reject a candidate missing required fields,
- verify the imported case is searchable by `matchProductIdea`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/opc/case-importer.test.js`

Expected: FAIL because `scripts/opc/import-case-candidates.js` does not exist yet.

### Task 2: Importer Script

**Files:**
- Create: `scripts/opc/import-case-candidates.js`
- Test: `node tests/opc/case-importer.test.js`

- [ ] **Step 1: Implement minimal importer**

Create an exported `importCaseCandidates(options)` function and CLI.

Required behavior:
- `options.root` defaults to repo root.
- `options.input` defaults to `knowledge/cases/candidates/case-candidates.jsonl`.
- Candidate fields: `id`, `source_id`, `url`, `title`, `language`, `raw_signal`, `name`, `founder_type`, `geography`, `target_user`, `product_form`, `route`, `acquisition`, `delivery`, `pricing`, `summary`, `commercial_path`, `risks`, `confidence`.
- Generated IDs: `raw_<id>` and `case_<id>`.
- Duplicate check covers existing raw IDs, normalized IDs, and normalized `evidence_urls`.
- Append valid rows to `knowledge/cases/raw/raw-cases.jsonl` and `knowledge/cases/normalized/normalized-cases.jsonl`.
- Return `{ imported, skipped, errors }`.
- CLI exits non-zero on errors unless `--allow-skip` is passed.

- [ ] **Step 2: Run test to verify it passes**

Run: `node tests/opc/case-importer.test.js`

Expected: PASS.

### Task 3: Candidate Pool and Package Scripts

**Files:**
- Create: `knowledge/cases/candidates/case-candidates.jsonl`
- Modify: `package.json`
- Modify: `knowledge/cases/README.md`
- Test: `npm run opc:import:cases -- --dry-run`

- [ ] **Step 1: Add empty candidate pool**

Create `knowledge/cases/candidates/case-candidates.jsonl` with a single comment-free JSONL placeholder not required. If no candidates exist, the importer should return zero imported rows.

- [ ] **Step 2: Add package scripts**

Add:
- `opc:import:cases`: `node scripts/opc/import-case-candidates.js`
- `opc:import:cases:dry`: `node scripts/opc/import-case-candidates.js --dry-run`

- [ ] **Step 3: Document workflow**

Update `knowledge/cases/README.md` with the candidate-to-library workflow:
1. put short candidate rows into `knowledge/cases/candidates/case-candidates.jsonl`,
2. run dry-run,
3. import,
4. run validation,
5. rebuild index.

### Task 4: Verification and Commit

**Files:**
- All files touched above.

- [ ] **Step 1: Run full verification**

Run:
- `node tests/opc/case-importer.test.js`
- `node tests/opc/product-idea-matcher.test.js`
- `npm run opc:validate:cases:seed`
- `npm run opc:case:index`
- `npm run opc:case:context:test`
- `git diff --check`

- [ ] **Step 2: Commit**

Run:
- `git add docs/superpowers/plans/2026-05-11-case-import-pipeline.md scripts/opc/import-case-candidates.js tests/opc/case-importer.test.js knowledge/cases/candidates/case-candidates.jsonl knowledge/cases/README.md package.json knowledge/cases/indexes/case-route-index.json`
- `git commit -m "feat(opc): add case candidate import pipeline"`

