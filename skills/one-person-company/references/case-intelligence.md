# Case Intelligence

The repository contains a structured one-person-company case library under `knowledge/cases/`.
It also contains GitHub-derived practice signals under `knowledge/github-sources/` for concrete operational lessons from open-source one-person-company, indie developer, acquisition, and infrastructure repositories.

## Data Files

- `source-map.jsonl`: where cases came from and collection boundaries.
- `raw/raw-cases.jsonl`: short metadata-level signals, not copied articles.
- `normalized/normalized-cases.jsonl`: comparable cases with user, route, acquisition, delivery, pricing, risks, and commercial path.
- `gold/gold-cases.jsonl`: high-signal cases with reusable lessons and warning flags.
- `indexes/case-route-index.json`: route-oriented lookup index generated from normalized cases.

GitHub source files:

- `knowledge/github-sources/source-map.jsonl`: high-value GitHub repositories and why each source matters.
- `knowledge/github-sources/practice-signals.jsonl`: structured practical signals covering payment, delivery, acquisition, business model, China reality, solo infrastructure, and operating principles.

## Retrieval

Run:

```bash
node scripts/opc/match-product-idea.js "我想做一个面向小红书商家的AI选题工具"
```

Use the result to answer:

- Which cases are genuinely similar?
- What route did they use to get paid?
- What part can be copied by a solo founder?
- What part is not transferable because of timing, audience, capital, brand, platform, or data advantage?
- What validation action follows from the comparison?

When the question involves practical execution, also check GitHub practice signals:

- Payment and first transaction paths.
- Acquisition channels and launch surfaces.
- Delivery boundaries and low-overhead operations.
- Domestic adaptation of overseas indie patterns.
- Personal intelligence systems and solo-founder infrastructure.

## Case Use Rules

- Do not name-drop cases as decoration. Explain the commercial mechanism.
- Do not overfit from global indie-hacker examples to China without adjusting for channel, payment, compliance, and trust.
- Prefer adjacent substitutes when exact competitors are missing. A paid agency, template, course, community, spreadsheet, API, or workflow hack can prove demand.
- Treat old cases as directional evidence. Flag when the channel or market may have changed.
- Treat GitHub stars as attention evidence, not payment evidence.
- Extract practical signals from repositories; do not copy long README or article text.

## Similar Case Answer Shape

```text
最像的 3 类：
1. 案例 / 替代方案：用户、收费方式、获客路径
2. 案例 / 替代方案：用户、收费方式、获客路径
3. 案例 / 替代方案：用户、收费方式、获客路径

能复制：
- ...

不能复制：
- ...

对你的判断：
- 更该做什么版本
- 不该做什么版本
- 下一步验证
```
