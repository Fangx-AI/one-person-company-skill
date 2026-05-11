# One-Person Company Case Intelligence Library

This directory stores structured case intelligence for the one-person-company product. It is not an article archive and must not contain copied long-form content.

## Layers

- `source-map.jsonl`: source registry. Each row represents one sustainable source bucket for manual review or future scraping.
- `candidates/case-candidates.jsonl`: staging area for new case candidates before they enter the formal library.
- `raw/raw-cases.jsonl`: raw evidence pointers. Store title, URL, short signal, capture date, language, and rights note.
- `normalized/normalized-cases.jsonl`: comparable business cases derived from raw evidence.
- `gold/gold-cases.jsonl`: high-value benchmark cases with reusable lessons and warning flags.
- `indexes/case-route-index.json`: generated route index. Rebuild it with `npm run opc:case:index`.
- `schema/*.json`: field contracts for each layer.

## Rules

- Store public metadata, short summaries, structured facts, and our own commercial judgment.
- Do not store copied articles, long excerpts, or large chunks of original source text.
- Every normalized case must trace back to at least one raw case.
- Every gold case must trace back to one normalized case.
- A useful case should make these clear: product form, target user, acquisition path, delivery method, pricing model, commercial bottleneck, and China-specific transfer risk when relevant.

## Candidate Import Workflow

Put new rows into `candidates/case-candidates.jsonl` first. Each row must be one JSON object with these fields:

```json
{"id":"example_case","source_id":"src_public_product_pages","url":"https://example.com","title":"Example","language":"en","raw_signal":"Short public signal only.","name":"Example","founder_type":"solo_founder","geography":["global"],"target_user":["founders"],"product_form":["case_library"],"route":["case_intelligence_product"],"acquisition":["seo"],"delivery":["website"],"pricing":["subscription"],"summary":"Compact summary.","commercial_path":"How the case makes money.","risks":["case_facts_age_quickly"],"confidence":"medium"}
```

Then run:

```bash
npm run opc:import:cases:dry
npm run opc:import:cases
npm run opc:validate:cases:seed
npm run opc:case:index
```

The importer writes `raw_<id>` and `case_<id>`, rejects duplicate evidence URLs, and skips invalid rows only when called with `--allow-skip`.

## Current Targets

The current seed gate is:

- 100 raw cases
- 100 normalized cases
- 30 gold cases

The v0.1 target remains:

- 1000 raw cases
- 300 normalized cases
- 50 gold cases
