# 一人公司内参 Skill System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repo-local v0.1 “一人公司内参” skill toolbox and knowledge base, with validation gates and a safe Book of Elon retirement inventory.

**Architecture:** Create five Codex-style skills under `skills/`, all reading a shared `knowledge/` directory made of method packs and JSONL knowledge atoms. Add deterministic Node.js validation so the skill assets can be checked without calling an LLM. Do not delete Book of Elon code in this plan; only create a local retirement inventory and preserve server safety rules.

**Tech Stack:** Markdown skill files, YAML frontmatter, JSONL, JSON Schema, Node.js 20+, existing npm scripts, Git.

---

## Workspace

Root: `C:\Users\PC\Desktop\skill_The_book_of_Elon`

Source spec: `docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md`

Non-negotiable safety rule: do not edit or delete any server-side files, remote hosts, PM2 processes, Nginx config, databases, `.env`, or old Book of Elon runtime code while executing this plan.

---

## File Structure

Create:

- `skills/opc/SKILL.md`
- `skills/opc-diagnosis/SKILL.md`
- `skills/opc-content/SKILL.md`
- `skills/opc-benchmark/SKILL.md`
- `skills/opc-china-reality/SKILL.md`
- `knowledge/README.md`
- `knowledge/packs/principles.md`
- `knowledge/packs/diagnosis-framework.md`
- `knowledge/packs/content-commerce.md`
- `knowledge/packs/benchmark-framework.md`
- `knowledge/packs/china-realities.md`
- `knowledge/packs/case-library.md`
- `knowledge/packs/playbooks.md`
- `knowledge/packs/quality-rubric.md`
- `knowledge/packs/anti-patterns.md`
- `knowledge/atoms/atom.schema.json`
- `knowledge/atoms/atoms.jsonl`
- `knowledge/evals/pressure-questions.md`
- `knowledge/evals/scoring-sheet.md`
- `scripts/opc/validate-knowledge.js`
- `docs/superpowers/audits/2026-05-11-book-of-elon-retirement-inventory.md`

Modify:

- `package.json`

Do not modify in this plan:

- `server.js`
- `web/`
- `routes/`
- `services/`
- `auth/`
- `db/`
- `data/`
- `.env`
- `ecosystem.config.js`
- `nginx.book-of-elon.conf.example`
- Any server files outside this local repo

---

### Task 1: Add The Validation Gate First

**Files:**

- Create: `scripts/opc/validate-knowledge.js`
- Modify: `package.json`

- [ ] **Step 1: Create the failing validation script**

Create `scripts/opc/validate-knowledge.js` with this content:

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

const requiredSkills = [
  'opc',
  'opc-diagnosis',
  'opc-content',
  'opc-benchmark',
  'opc-china-reality',
];

const requiredPacks = [
  'principles.md',
  'diagnosis-framework.md',
  'content-commerce.md',
  'benchmark-framework.md',
  'china-realities.md',
  'case-library.md',
  'playbooks.md',
  'quality-rubric.md',
  'anti-patterns.md',
];

const requiredAtomFields = [
  'id',
  'knowledge',
  'source',
  'source_type',
  'date_checked',
  'topics',
  'routes',
  'stage',
  'risk',
  'type',
  'confidence',
];

const incompleteMarkers = [
  'TO' + 'DO',
  'TB' + 'D',
  '\u5f85\u5b9a',
  '\u7a0d\u540e\u8865\u5145',
  'fill' + ' in',
  'place' + 'holder',
];

const forbiddenConclusionPhrases = [
  '持续输出',
  '打造个人品牌',
  '找到痛点',
  '做 MVP',
  '先做 SEO',
  '去备案',
  '接入支付',
  '多发小红书',
  '做差异化',
  '坚持下去',
];

const errors = [];

function readText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Missing ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function assertNoIncompleteMarkers(relativePath, text) {
  for (const marker of incompleteMarkers) {
    if (text.includes(marker)) {
      errors.push(`${relativePath} contains incomplete marker: ${marker}`);
    }
  }
}

function assertSkill(relativePath, expectedName) {
  const text = readText(relativePath);
  if (!text) return;

  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatterMatch) {
    errors.push(`${relativePath} is missing YAML frontmatter`);
    return;
  }

  const frontmatter = frontmatterMatch[1];
  if (!frontmatter.includes(`name: ${expectedName}`)) {
    errors.push(`${relativePath} frontmatter must contain name: ${expectedName}`);
  }
  if (!/description:\s+.+/.test(frontmatter)) {
    errors.push(`${relativePath} frontmatter must contain a non-empty description`);
  }
  if (!text.includes('## Workflow')) {
    errors.push(`${relativePath} must include a ## Workflow section`);
  }
  if (!text.includes('knowledge/packs')) {
    errors.push(`${relativePath} must reference shared knowledge packs`);
  }
  assertNoIncompleteMarkers(relativePath, text);
}

function validateSkills() {
  for (const skill of requiredSkills) {
    assertSkill(path.join('skills', skill, 'SKILL.md'), skill);
  }
}

function validatePacks() {
  for (const pack of requiredPacks) {
    const relativePath = path.join('knowledge', 'packs', pack);
    const text = readText(relativePath);
    if (!text) continue;
    if (text.trim().length < 500) {
      errors.push(`${relativePath} is too thin; expected at least 500 characters`);
    }
    assertNoIncompleteMarkers(relativePath, text);
  }
}

function validateAtomSchema() {
  const schema = readText(path.join('knowledge', 'atoms', 'atom.schema.json'));
  if (!schema) return;
  try {
    JSON.parse(schema);
  } catch (error) {
    errors.push(`knowledge/atoms/atom.schema.json is invalid JSON: ${error.message}`);
  }
}

function validateAtoms() {
  const relativePath = path.join('knowledge', 'atoms', 'atoms.jsonl');
  const text = readText(relativePath);
  if (!text) return;

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 50) {
    errors.push(`${relativePath} must contain at least 50 atoms; found ${lines.length}`);
  }

  const ids = new Set();
  lines.forEach((line, index) => {
    let atom;
    try {
      atom = JSON.parse(line);
    } catch (error) {
      errors.push(`${relativePath}:${index + 1} invalid JSON: ${error.message}`);
      return;
    }

    for (const field of requiredAtomFields) {
      if (!(field in atom)) {
        errors.push(`${relativePath}:${index + 1} missing field: ${field}`);
      }
    }

    if (atom.id) {
      if (ids.has(atom.id)) {
        errors.push(`${relativePath}:${index + 1} duplicate id: ${atom.id}`);
      }
      ids.add(atom.id);
    }

    for (const arrayField of ['topics', 'routes', 'stage', 'risk']) {
      if (!Array.isArray(atom[arrayField]) || atom[arrayField].length === 0) {
        errors.push(`${relativePath}:${index + 1} ${arrayField} must be a non-empty array`);
      }
    }

    if (!['high', 'medium', 'low'].includes(atom.confidence)) {
      errors.push(`${relativePath}:${index + 1} confidence must be high, medium, or low`);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(atom.date_checked || '')) {
      errors.push(`${relativePath}:${index + 1} date_checked must be YYYY-MM-DD`);
    }
  });
}

function validatePressureQuestions() {
  const relativePath = path.join('knowledge', 'evals', 'pressure-questions.md');
  const text = readText(relativePath);
  if (!text) return;

  const questionCount = (text.match(/^\| \d+ \|/gm) || []).length;
  if (questionCount !== 20) {
    errors.push(`${relativePath} must contain exactly 20 numbered pressure questions; found ${questionCount}`);
  }

  assertNoIncompleteMarkers(relativePath, text);
}

function validateRubric() {
  const relativePath = path.join('knowledge', 'packs', 'quality-rubric.md');
  const text = readText(relativePath);
  if (!text) return;

  for (const phrase of forbiddenConclusionPhrases) {
    if (!text.includes(phrase)) {
      errors.push(`${relativePath} must include forbidden phrase guardrail: ${phrase}`);
    }
  }
}

function main() {
  validateSkills();
  validatePacks();
  validateAtomSchema();
  validateAtoms();
  validatePressureQuestions();
  validateRubric();

  if (errors.length > 0) {
    console.error('OPC knowledge validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('OPC knowledge validation passed.');
}

main();
```

- [ ] **Step 2: Run the validation script and verify it fails for missing files**

Run:

```powershell
node scripts/opc/validate-knowledge.js
```

Expected: `FAIL` with missing paths such as `Missing skills/opc/SKILL.md`.

- [ ] **Step 3: Add the npm script**

Modify `package.json` inside `"scripts"` by adding:

```json
"opc:validate": "node scripts/opc/validate-knowledge.js"
```

Keep valid JSON by adding a comma to the previous script entry.

- [ ] **Step 4: Run the npm validation command and verify it still fails for missing files**

Run:

```powershell
npm run opc:validate
```

Expected: `FAIL` with missing `skills/` and `knowledge/` files.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/opc/validate-knowledge.js
git commit -m "test(opc): add knowledge validation gate"
```

---

### Task 2: Scaffold The Five Skill Folders

**Files:**

- Create: `skills/opc/SKILL.md`
- Create: `skills/opc-diagnosis/SKILL.md`
- Create: `skills/opc-content/SKILL.md`
- Create: `skills/opc-benchmark/SKILL.md`
- Create: `skills/opc-china-reality/SKILL.md`

- [ ] **Step 1: Generate skill directories with the skill creator script**

Run:

```powershell
python C:\Users\PC\.codex\skills\.system\skill-creator\scripts\init_skill.py opc --path C:\Users\PC\Desktop\skill_The_book_of_Elon\skills --resources references
python C:\Users\PC\.codex\skills\.system\skill-creator\scripts\init_skill.py opc-diagnosis --path C:\Users\PC\Desktop\skill_The_book_of_Elon\skills --resources references
python C:\Users\PC\.codex\skills\.system\skill-creator\scripts\init_skill.py opc-content --path C:\Users\PC\Desktop\skill_The_book_of_Elon\skills --resources references
python C:\Users\PC\.codex\skills\.system\skill-creator\scripts\init_skill.py opc-benchmark --path C:\Users\PC\Desktop\skill_The_book_of_Elon\skills --resources references
python C:\Users\PC\.codex\skills\.system\skill-creator\scripts\init_skill.py opc-china-reality --path C:\Users\PC\Desktop\skill_The_book_of_Elon\skills --resources references
```

Expected: five folders exist under `skills/`.

- [ ] **Step 2: Remove generated sample reference files if present**

If the generator creates sample files under `skills/*/references/`, delete only those sample files and leave the folders. Do not delete `SKILL.md`.

Run:

```powershell
Get-ChildItem -Path .\skills -Recurse -File | Select-String -Pattern ('TO' + 'DO'), ('TB' + 'D'), ('place' + 'holder')
```

Expected: generated sample content may be listed before Task 5 replaces the skill bodies.

- [ ] **Step 3: Do not commit yet**

The generated skill bodies are intentionally incomplete. Continue to Tasks 3-5 before committing.

---

### Task 3: Create Shared Knowledge Packs

**Files:**

- Create: `knowledge/README.md`
- Create: `knowledge/packs/principles.md`
- Create: `knowledge/packs/diagnosis-framework.md`
- Create: `knowledge/packs/content-commerce.md`
- Create: `knowledge/packs/benchmark-framework.md`
- Create: `knowledge/packs/china-realities.md`
- Create: `knowledge/packs/case-library.md`
- Create: `knowledge/packs/playbooks.md`
- Create: `knowledge/packs/quality-rubric.md`
- Create: `knowledge/packs/anti-patterns.md`

- [ ] **Step 1: Create the knowledge directory structure**

Run:

```powershell
New-Item -ItemType Directory -Force .\knowledge\packs, .\knowledge\atoms, .\knowledge\evals
```

Expected: directories exist.

- [ ] **Step 2: Create `knowledge/README.md`**

Content:

```markdown
# 一人公司内参 Knowledge Base

This directory is the shared knowledge layer for the `opc` skill toolbox.

## Structure

- `packs/*.md`: stable frameworks and operating rules.
- `atoms/atoms.jsonl`: small, sourced judgment cards.
- `evals/*.md`: pressure questions and scoring sheets.

## Update Rules

1. Prefer official sources for policy, platform, payment, hosting, and compliance claims.
2. Mark market observations as `market_observation`; do not present them as law.
3. Every time-sensitive atom must have `date_checked`.
4. Do not copy public projects into this repository. Extract original judgment in our own words.
5. Answers should be shorter because the knowledge is better, not longer because the prompt is bigger.
```

- [ ] **Step 3: Create `knowledge/packs/principles.md`**

Content:

```markdown
# Principles

## Core Position

一人公司内参 sells judgment quality, not generic startup advice.

The user is usually not lacking motivation. The user is usually missing one of these:

- a clear commercial bottleneck
- a realistic route under domestic constraints
- a low-resistance next action
- a stop-loss condition
- a way to avoid copying foreign or generic advice into the wrong market

## First-Principles Formula

```text
一人公司成立概率 =
  可触达需求
× 付费意愿
× 毛利
× 信任
× 复购/持续性
× 个人交付能力
÷ 获客成本
÷ 维护复杂度
÷ 平台/合规风险
÷ 创始人执行阻力
```

Every answer must identify which variable is currently weakest.

## Priority Order

1. Commercial loop before clever expression.
2. Real constraints before ideal routes.
3. Low-resistance action before correct but avoided advice.
4. Tradeoff before recommendation.
5. Stop-loss before endless persistence.

## Stages

| Stage | Question | Wrong Default |
|---|---|---|
| idea | Which buyer, pain, and money? | Build a complete product |
| validation | Will anyone stop, ask, or pay? | Register company, file ICP, build payment |
| first-revenue | How to collect first money? | Automate too early |
| acquisition | Which channel repeats? | Work every platform |
| delivery | How to reduce service load? | Add more manual labor |
| profit | How to improve margin and repeat purchase? | Only chase revenue |
| risk | How to manage entity, tax, platform, policy? | Treat temporary hacks as assets |

## Default Answer Shape

Use this sequence silently:

1. Stage.
2. Broken variable.
3. Business logic.
4. Case, atom, or domestic reality.
5. A/B tradeoff.
6. One low-resistance next action.
7. Stop-loss condition.
```

- [ ] **Step 4: Create `knowledge/packs/diagnosis-framework.md`**

Content:

```markdown
# Diagnosis Framework

## Diagnosis Goal

Diagnose the business mechanism, not the user's personality.

The answer should make the user feel: "I know exactly where this breaks."

## Input Triage

Classify the user's question into one primary type:

| Type | Common Signal | Primary Skill |
|---|---|---|
| viability | 能不能做, 值不值得, 要不要放弃 | opc-diagnosis |
| content | 小红书, 抖音, 公众号, 个人 IP, 涨粉不变现 | opc-content |
| benchmark | 学谁, 对标, 国内能不能照搬 | opc-benchmark |
| reality | 备案, 支付, 主体, 服务器, 平台规则 | opc-china-reality |
| plan | 接下来怎么做, 1/7/30 天 | opc-diagnosis with playbooks |

## Broken Variable Checklist

- Demand: the buyer has no urgent cost of inaction.
- Reach: the founder cannot reliably reach buyers.
- Trust: the user may need the result but has no reason to believe this founder.
- Pricing: price is not screening the right customer or funding delivery.
- Margin: the offer creates low-margin, high-service work.
- Delivery: every sale creates more custom labor.
- Retention: no reason to buy again or continue.
- Risk: platform, policy, payment, entity, or content risk can interrupt the route.
- Founder friction: the recommended action is correct but the founder will not do it.

## Diagnosis Output Rules

Lead with one sharp judgment.

Bad:

```text
你需要先做用户调研，找到痛点，然后做 MVP。
```

Good:

```text
你现在不是产品问题，是信任和成交承接问题。先不要加功能；用一个能收费的诊断入口测试是否有人愿意为结果付钱。
```

## Stop-Loss Patterns

Use stop-loss conditions when the user is stuck in motion:

- If no one asks for the result after 20 targeted exposures, the promise is unclear or the audience is wrong.
- If people praise but no one pays, the offer is trust/content, not product.
- If every paid delivery needs heavy customization, convert it into diagnostic, template, or limited-scope packages.
- If channel output grows but private messages do not, the content is entertainment or identity signaling, not purchase intent.
```

- [ ] **Step 5: Create `knowledge/packs/content-commerce.md`**

Content:

```markdown
# Content Commerce

## Core Judgment

Content is not a virtue. Content is a commercial interface.

Every content recommendation must answer:

- Who is the buyer?
- What result is promised?
- Why should they trust this account?
- What action should happen after reading?
- Which product or service does the content serve?
- What platform constraint changes the format?

## Six Content Jobs

| Job | Purpose | Failure Signal |
|---|---|---|
| reach | make target buyers stop | views from irrelevant people |
| trust | make buyer believe the founder | likes but no inquiry |
| screening | repel wrong customers | many low-quality chats |
| conversion | move to payment or consultation | private messages but no offer |
| private-domain | carry relationship outside platform | risky or awkward migration |
| retention | create repeat purchase/referral | one-off transaction |

## Platform Notes

Use platform notes as tradeoffs, not universal rules.

- Xiaohongshu is strong for search-like intent, lifestyle trust, and visual proof, but private-message and traffic rules affect conversion.
- Douyin is strong for volume and live conversion, but dependency and production pressure are high.
- WeChat public account is slower for reach but stronger for trust archives and private-domain continuity.
- Private domain is not free. It creates service, moderation, and account-risk debt.

## Anti-Empty Advice

Do not end with:

- 持续输出
- 打造个人品牌
- 多发小红书
- 发干货
- 做私域

Convert them:

```text
不要“持续输出”。连续发 7 条同一买家、同一结果、同一入口的内容，只测一件事：有没有人私信问价格或下一步。
```

## Content Diagnosis Template

```text
主判断：
这不是涨粉问题，是内容没有承接到一个可购买结果。

断点：
信任/成交入口/产品定义。

两条路：
A. 做轻诊断入口，低客单先收第一笔钱。
B. 做内容栏目沉淀信任，但必须绑定一个明确产品。

下一步：
把最近 10 条内容按“买家、结果、入口”三列重写标题，只发最像购买意图的一条。

停损：
如果 7 条内容没有任何有效咨询，换买家或换承诺，不要加平台。
```
```

- [ ] **Step 6: Create `knowledge/packs/benchmark-framework.md`**

Content:

```markdown
# Benchmark Framework

## Benchmark Goal

Cases are not inspiration. Cases are business structure.

Do not say "learn from X" until the copyable and non-copyable parts are separated.

## Case Template

```text
案例名：
来源：
适用路线：
阶段：
卖给谁：
卖什么：
价格/收入信号：
获客方式：
转化方式：
交付方式：
护城河：
一人公司可复制部分：
不可复制部分：
国内迁移风险：
一句判断：
```

## Copyability Filters

| Filter | Question |
|---|---|
| audience | Do we have access to the same buyers? |
| trust | Can we reproduce the trust source? |
| distribution | Is the channel available in China? |
| payment | Can domestic users pay in the same way? |
| compliance | Are claims, content, and delivery allowed? |
| founder fit | Can one founder sustain the work? |
| timing | Was the case dependent on a temporary wave? |

## Foreign Case Migration

For indie hacker examples, always evaluate:

- language and culture
- global payment vs domestic payment
- SEO/Twitter/Product Hunt vs Xiaohongshu/Douyin/WeChat
- SaaS willingness to pay
- ICP and hosting
- support expectations
- copycat speed and platform dependency

## Domestic Case Handling

Domestic cases often have incomplete public data. Mark unknowns clearly:

- public fact
- founder statement
- market observation
- inferred mechanism
- unverified rumor

Never fabricate revenue, conversion rate, or private data.
```

- [ ] **Step 7: Create `knowledge/packs/china-realities.md`**

Content:

```markdown
# China Realities

## Core Rule

Domestic reality is not a footnote. It changes the route.

When a question touches hosting, payment, entity, platform rules, private domain, ads, or regulated content, give tradeoffs and time-sensitivity.

## Hosting And ICP

Early validation:

- Hong Kong or Singapore hosting usually reduces ICP friction.
- It may reduce speed, trust, and platform compatibility.
- It is often acceptable for testing demand before heavy setup.

Long-term domestic operation:

- Mainland hosting generally requires ICP filing.
- Filing depends on entity, domain, cloud access provider, and content.
- Rules and provider workflows change; verify official docs before acting.

Default judgment:

```text
If no one has paid, do not turn ICP into the main task. Use a lower-friction validation surface first. If stable transactions exist, plan entity, ICP, payment, and long-term hosting together.
```

## Payment

Payment is not only checkout. It affects trust, refunds, reconciliation, risk control, and account stability.

Tradeoffs:

- Personal collection: fastest, weak for scale, invoices, trust, and risk.
- Official WeChat/Alipay merchant: stronger trust and operations, requires entity and review.
- Aggregators: lower integration friction, but platform and settlement risk must be checked.
- Manual transfer: useful for first revenue, poor for repeatability.

## Entity And Tax

Do not provide legal or tax advice as final authority.

Use direction-level guidance:

- first validate payment intent
- then choose individual business or company entity based on invoicing, payment, risk, and cost
- avoid mixing personal collection with high-volume commercial operation
- ask a professional when money, hiring, refunds, or regulated categories appear

## Platform And Private Domain

Private domain is not a magic answer.

- WeChat personal accounts have account-risk and service-load issues.
- Groups create moderation and delivery debt.
- Public accounts are slower but preserve trust assets.
- Mini programs can increase trust but add review and development cost.
- External-link and inducement rules can interrupt conversion paths.

## Content Compliance

Be conservative with:

- medical
- finance
- education promises
- income claims
- metaphysics and fortune claims
- exaggerated case claims
- guaranteed results

Every answer involving policy or platform rules must include:

```text
规则会变化，执行前要以平台或服务商最新官方说明为准。
```
```

- [ ] **Step 8: Create `knowledge/packs/case-library.md`**

Content:

```markdown
# Case Library

## Purpose

This pack defines how to use cases. Detailed case atoms live in `knowledge/atoms/atoms.jsonl`.

## Case Families

| Family | Examples | Use |
|---|---|---|
| foreign indie hacker | Pieter Levels, Marc Lou, Arvid Kahl, Daniel Vassallo | structure, not direct copying |
| solo creator business | Justin Welsh, newsletter/course operators | content-to-offer mechanics |
| domestic solo business | independent developers, WeChat/Xiaohongshu operators | domestic channel and payment reality |
| productized consulting | diagnostic, audit, automation packages | first revenue and scope control |
| failure cases | no paid users, heavy delivery, platform bans | stop-loss and anti-patterns |

## Case Use Rules

1. Use cases to explain mechanisms, not to worship founders.
2. Separate public facts from inference.
3. For foreign cases, always add domestic migration risk.
4. For domestic cases, avoid unverifiable revenue claims.
5. If a case has no source, label it as market observation.

## One-Line Case Judgment Examples

```text
Pieter Levels is not a "build many products" template; the copyable part is public shipping plus low-overhead products, while the hard-to-copy part is global audience and long compounding.
```

```text
Knowledge products are not automatically high-margin; if support and refunds grow with every sale, it becomes disguised service delivery.
```
```

- [ ] **Step 9: Create `knowledge/packs/playbooks.md`**

Content:

```markdown
# Playbooks

## Low-Resistance Validation

Use when the correct action is too hard and the user will avoid it.

Instead of:

```text
Find 10 target users and interview them.
```

Use:

```text
Today only do one thing: find 3 people who already complain about this problem. Do not introduce features. Ask: "How are you solving this now? What did it cost you? If I remove this step, would you pay this week?"
```

## First Revenue

Use when the user has an idea but no paid signal.

Route:

1. Define one buyer.
2. Define one expensive problem.
3. Offer one result.
4. Sell manually before building.
5. Deliver in the lightest acceptable way.
6. Extract repeatable parts.

## AI Tool Route

Use when the user wants to build AI software.

Default judgment:

- The product is not "AI"; the product is the result the buyer no longer has to produce manually.
- API cost must be controlled with quotas, model tiers, caching, and paid usage.
- Prompt products are weak unless bundled with workflow, data, or distribution.

## Productized Service Route

Use when the founder can solve the problem manually.

Guardrails:

- package diagnosis before implementation
- define scope in writing
- charge before delivery
- turn repeated steps into templates
- stop custom work from becoming the default

## 1/7/30 Day Plan Shape

```text
1 day: create one paid-facing promise and one manual payment path.
7 days: expose it to a narrow buyer group and collect objections.
30 days: turn paid delivery into a repeatable package or stop.
```
```

- [ ] **Step 10: Create `knowledge/packs/quality-rubric.md`**

Content:

```markdown
# Quality Rubric

Every answer starts at 0 and can earn 10 points.

| Dimension | Points | Standard |
|---|---:|---|
| commercial essence | 2 | identifies demand, channel, pricing, margin, delivery, repeat purchase, or risk |
| domestic reality | 2 | includes platform, payment, ICP, entity, private-domain, or policy constraints when relevant |
| case grounding | 1.5 | uses case structure, source, or explicit market observation |
| route planning | 1.5 | identifies stage and viable path |
| executability | 1.5 | next step is low-resistance enough to actually happen |
| expression | 1 | concise, direct, no filler |
| uncertainty | 0.5 | marks time-sensitive or unverified claims |

Below 7 is unacceptable.

## Direct Failure

Fail the answer if it:

- gives only comfort
- gives theory without domestic reality
- recommends a large action without friction or alternative
- fabricates cases, revenue, or sources
- treats platform/payment/ICP rules as timeless
- uses empty terms as the conclusion

## Forbidden As Conclusions

These phrases may appear only if immediately converted into a concrete action:

- 持续输出
- 打造个人品牌
- 找到痛点
- 做 MVP
- 先做 SEO
- 去备案
- 接入支付
- 多发小红书
- 做差异化
- 坚持下去

## Preferred Output Shape

```text
主判断：

断点：

为什么：

两条路：

下一步：

停损：
```
```

- [ ] **Step 11: Create `knowledge/packs/anti-patterns.md`**

Content:

```markdown
# Anti-Patterns

## Product Anti-Patterns

- Building a complete product before confirming payment intent.
- Treating a website as the business.
- Adding AI where the buyer wants a business result.
- Offering lifetime unlimited access before proving cost structure.
- Confusing users, audience, followers, and buyers.

## Content Anti-Patterns

- Chasing views from people who cannot buy.
- Posting education content without a transaction path.
- Moving everyone to private domain without service capacity.
- Copying platform tactics without understanding product route.

## China-Reality Anti-Patterns

- Saying "go file ICP" before knowing stage and hosting need.
- Treating Hong Kong hosting as a permanent no-risk answer.
- Using personal collection as a high-volume payment strategy.
- Building a mini program before the offer is validated.
- Ignoring platform account risk in private-domain strategies.

## Consulting And Service Anti-Patterns

- Selling "陪跑" without boundary.
- Charging low price for high-touch service.
- Delivering custom automation without productized scope.
- Letting customer support become the real product.

## Response Anti-Patterns

Bad:

```text
你要坚持持续输出，打造差异化 IP。
```

Better:

```text
你不是缺内容，是缺一个能承接付款的结果。下一条内容只写给一种买家，并在结尾给一个付费诊断入口。
```
```

- [ ] **Step 12: Run validation and verify expected failures move forward**

Run:

```powershell
npm run opc:validate
```

Expected: validation still fails because `skills/*/SKILL.md`, atom schema, atoms, and pressure questions are not complete. It should no longer report missing `knowledge/packs/*.md`.

---

### Task 4: Add Atom Schema And 50+ Seed Atoms

**Files:**

- Create: `knowledge/atoms/atom.schema.json`
- Create: `knowledge/atoms/atoms.jsonl`

- [ ] **Step 1: Create `knowledge/atoms/atom.schema.json`**

Content:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "OPC Knowledge Atom",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id",
    "knowledge",
    "original",
    "source",
    "source_type",
    "date_checked",
    "topics",
    "routes",
    "stage",
    "risk",
    "type",
    "confidence"
  ],
  "properties": {
    "id": { "type": "string", "pattern": "^opc_[0-9]{4}_[0-9]{4}$" },
    "knowledge": { "type": "string", "minLength": 20 },
    "original": { "type": "string" },
    "source": { "type": "string" },
    "source_type": {
      "type": "string",
      "enum": ["official_doc", "case", "interview", "book", "founder_note", "market_observation"]
    },
    "date_checked": { "type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    "topics": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "routes": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "stage": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "risk": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "type": {
      "type": "string",
      "enum": ["principle", "constraint", "case", "playbook", "anti_pattern", "rubric"]
    },
    "confidence": { "type": "string", "enum": ["high", "medium", "low"] }
  }
}
```

- [ ] **Step 2: Create `knowledge/atoms/atoms.jsonl` with 55 seed atoms**

Use these lines exactly as the first seed set:

```jsonl
{"id":"opc_2026_0001","knowledge":"验证期不应默认选择大陆备案；若目标是快速验证需求，香港或新加坡节点通常更低摩擦。","original":"腾讯云和阿里云文档均说明中国香港及境外服务器不需要 ICP 备案；大陆服务器和备案资源绑定更紧。","source":"https://cloud.tencent.cn/document/product/243/18908","source_type":"official_doc","date_checked":"2026-05-11","topics":["hosting","icp","china-reality"],"routes":["software","content","service"],"stage":["validation","launch"],"risk":["policy","ops"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0002","knowledge":"备案不是商业验证动作；它解决长期合规和信任，不解决有没有人愿意付钱。","original":"从一人公司阶段路线推导：验证期的主问题是付费信号，不是基础设施完整度。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["icp","validation"],"routes":["software","content"],"stage":["validation"],"risk":["execution","policy"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0003","knowledge":"大陆服务器适合长期品牌、访问稳定和部分生态接入，但会增加备案、主体、内容和接入商约束。","original":"国内云资源通常与 ICP、主体、域名和内容审核流程相关。","source":"https://www.alibabacloud.com/help/zh/icp-filing/basic-icp-service/user-guide/icp-filing-server-access-information-check","source_type":"official_doc","date_checked":"2026-05-11","topics":["hosting","icp","entity"],"routes":["software"],"stage":["launch","risk"],"risk":["policy","ops"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0004","knowledge":"香港服务器不是永久免风险方案；它降低备案摩擦，但可能牺牲访问速度、平台兼容和长期信任。","original":"对香港节点的商业权衡总结，适用于早期验证与长期经营取舍。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["hosting","icp","tradeoff"],"routes":["software","content"],"stage":["validation","launch"],"risk":["ops","trust"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0005","knowledge":"支付方式不是纯技术集成；它同时影响信任、退款、对账、风控、主体和长期经营。","original":"一人公司支付坑位来自微信/支付宝商户、个人收款、聚合支付、退款和封控。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["payment","trust","ops"],"routes":["software","knowledge","service"],"stage":["first-revenue","risk"],"risk":["platform","legal","ops"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0006","knowledge":"第一笔收入可以手工收款，但不能把手工收款包装成长期支付系统。","original":"第一笔收入阶段追求付款信号；风险治理阶段再处理主体、商户和对账。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["payment","first-revenue"],"routes":["consulting","knowledge","service"],"stage":["first-revenue"],"risk":["legal","ops"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0007","knowledge":"没有公司主体时，不要先追求完整自动支付；先验证用户是否愿意为明确结果付钱。","original":"支付集成不是验证期主矛盾；先通过低摩擦方式获得真实付款意愿。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["payment","entity","validation"],"routes":["knowledge","service","software"],"stage":["validation","first-revenue"],"risk":["execution","legal"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0008","knowledge":"个体户、有限公司和个人收款不是身份偏好问题，而是开票、商户、税务、风险和客户信任的组合选择。","original":"公司主体坑位来自经营范围、开票、税务、支付商户和客户信任。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["entity","tax","payment"],"routes":["software","knowledge","service"],"stage":["first-revenue","risk"],"risk":["legal","ops"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0009","knowledge":"一人公司的根本矛盾是一个人的资源有限，但商业闭环要求完整。","original":"一人公司不是小公司，而是需要压低协作、固定成本、交付和维护债的特殊结构。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["principle","solo-business"],"routes":["all"],"stage":["idea","validation","delivery"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0010","knowledge":"一个想法能不能做，要看可触达需求、付费意愿、毛利、信任、复购、交付能力与风险成本的乘除关系。","original":"一人公司成立概率公式。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["principle","diagnosis"],"routes":["all"],"stage":["idea","validation"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0011","knowledge":"用户夸产品不等于需求成立；愿意付钱、付出时间或替换现有方案才是更强信号。","original":"商业验证应看用户是否已经为问题付出代价。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["validation","demand"],"routes":["all"],"stage":["validation"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0012","knowledge":"没有人用 AI 工具时，不要先加功能；先判断断点在需求、触达、信任还是结果承诺。","original":"AI 工具没人用可能是商业断点，不一定是产品功能不足。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["ai-tool","diagnosis"],"routes":["software","ai-service"],"stage":["validation"],"risk":["execution","cost"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0013","knowledge":"AI 产品卖点不能停在 AI；买家付钱买的是被省掉的步骤、降低的成本或得到的结果。","original":"AI 工具同质化时，交付应为结果而非 AI。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["ai-tool","offer"],"routes":["software","ai-service"],"stage":["idea","validation"],"risk":["execution","cost"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0014","knowledge":"提示词或智能体如果只卖文本，很容易同质化；要绑定工作流、数据、交付结果或渠道。","original":"提示词商品化风险来自可复制、难防守和结果不稳定。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["ai-tool","prompt","offer"],"routes":["knowledge","software","ai-service"],"stage":["idea","validation"],"risk":["competition","execution"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0015","knowledge":"API 成本失控通常不是技术事故，而是产品计费、限额、模型层级和滥用防护没有闭环。","original":"Book of Elon 公开开放导致 API 成本风险，是新产品必须吸收的教训。","source":"docs/runbooks/incident-cost-spike.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["api-cost","pricing","risk"],"routes":["software","ai-service"],"stage":["launch","risk"],"risk":["cost","ops"],"type":"anti_pattern","confidence":"high"}
{"id":"opc_2026_0016","knowledge":"Lifetime unlimited 对 AI 产品很危险，因为收入一次性、成本持续发生、滥用没有上限。","original":"旧 paywall 方向中的 lifetime/unlimited 经济模型不成立。","source":"docs/superpowers/plans/2026-04-28-paywall-onboarding.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["pricing","api-cost"],"routes":["software","ai-service"],"stage":["launch"],"risk":["cost"],"type":"anti_pattern","confidence":"high"}
{"id":"opc_2026_0017","knowledge":"内容不是为了涨粉，而是为触达、信任、筛选、成交、私域承接或复购中的某一个环节服务。","original":"内容商业必须区分六种内容工作。","source":"knowledge/packs/content-commerce.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["content","commercial-loop"],"routes":["content","knowledge","consulting"],"stage":["acquisition"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0018","knowledge":"小红书 3000 粉丝没有收入，常见断点不是粉丝少，而是内容没有绑定可购买结果。","original":"内容涨粉和商业转化是不同任务。","source":"knowledge/packs/content-commerce.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["xiaohongshu","content","conversion"],"routes":["content","knowledge"],"stage":["acquisition"],"risk":["execution","platform"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0019","knowledge":"不露脸可以做内容商业，但信任证据必须由案例、过程、结果、专业判断或交付样本承担。","original":"露脸只是信任来源之一，不是唯一方式。","source":"knowledge/packs/content-commerce.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["content","trust"],"routes":["content","knowledge","consulting"],"stage":["acquisition"],"risk":["trust"],"type":"playbook","confidence":"medium"}
{"id":"opc_2026_0020","knowledge":"私域不是万能答案；它会带来客服、交付、封号、群管理和持续维护成本。","original":"私域坑位包括加微信路径、社群交付、朋友圈成交、封号风险和客服压力。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["private-domain","wechat","ops"],"routes":["content","knowledge","service"],"stage":["acquisition","delivery"],"risk":["platform","ops"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0021","knowledge":"公众号 reach 慢，但适合沉淀信任资产；短视频 reach 快，但生产压力和平台依赖更强。","original":"内容平台选择要看触达、信任、承接和平台风险。","source":"knowledge/packs/content-commerce.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["content","wechat","douyin"],"routes":["content","knowledge"],"stage":["acquisition"],"risk":["platform","execution"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0022","knowledge":"内容矩阵不是免费规模化；它会放大生产、风控、账号管理和质量控制压力。","original":"AI 内容矩阵常见风险包括同质化、平台限流和低信任内容。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"market_observation","date_checked":"2026-05-11","topics":["content","ai","platform"],"routes":["content","ai-service"],"stage":["acquisition"],"risk":["platform","execution"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0023","knowledge":"知识产品价格不是 99 或 199 的选择，而是承诺结果、信任强度、交付成本和退款风险的组合。","original":"定价本身会筛选用户并定义产品边界。","source":"knowledge/packs/principles.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["pricing","knowledge-product"],"routes":["knowledge"],"stage":["first-revenue","profit"],"risk":["delivery","trust"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0024","knowledge":"低价课如果需要高触达和高答疑，可能比高价诊断更消耗一人公司。","original":"低价高客服是毛利陷阱。","source":"knowledge/packs/anti-patterns.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["pricing","delivery"],"routes":["knowledge","consulting"],"stage":["delivery","profit"],"risk":["delivery","ops"],"type":"anti_pattern","confidence":"high"}
{"id":"opc_2026_0025","knowledge":"陪跑社群如果没有边界，会把产品变成无限咨询和情绪劳动。","original":"创业陪跑应定义范围、节奏、答疑边界和可交付物。","source":"knowledge/packs/anti-patterns.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["community","delivery"],"routes":["knowledge","consulting"],"stage":["delivery"],"risk":["delivery","ops"],"type":"anti_pattern","confidence":"high"}
{"id":"opc_2026_0026","knowledge":"咨询产品化的第一步是卖诊断，不是承诺代做结果；诊断更容易控范围、收钱和沉淀方法。","original":"产品化服务路线要求先包装诊断，再决定实施。","source":"knowledge/packs/playbooks.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["consulting","offer"],"routes":["consulting","service"],"stage":["first-revenue"],"risk":["delivery"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0027","knowledge":"AI 自动化服务最容易变成外包；必须限定场景、输入、输出、修改次数和维护责任。","original":"AI 服务可先手工交付验证，但要防止定制交付膨胀。","source":"knowledge/packs/playbooks.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["ai-service","delivery"],"routes":["ai-service","consulting"],"stage":["first-revenue","delivery"],"risk":["delivery","ops"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0028","knowledge":"技术创始人不会销售时，不要先学完整销售体系；先把产品改成可被一句话理解的付费结果。","original":"销售困难经常来自 offer 不清，而不是话术不足。","source":"knowledge/packs/diagnosis-framework.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["sales","offer"],"routes":["software","ai-service","consulting"],"stage":["validation","first-revenue"],"risk":["execution"],"type":"playbook","confidence":"medium"}
{"id":"opc_2026_0029","knowledge":"没有流量的 SaaS 不应默认先做产品；应先证明能触达买家或用服务形态拿到付费信号。","original":"软件工具最大风险是获客难、同质化和维护债。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["saas","acquisition"],"routes":["software"],"stage":["idea","validation"],"risk":["execution","cost"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0030","knowledge":"功能很多但用户不付费，优先删到一个付费结果，而不是继续补功能。","original":"功能数量不能替代需求、信任和成交。","source":"knowledge/packs/diagnosis-framework.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["product","pricing"],"routes":["software","ai-service"],"stage":["validation"],"risk":["execution"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0031","knowledge":"每月赚 1 万的路线更适合从高信任服务、诊断、模板或小众工具切入，而不是一开始追求大平台规模。","original":"月入 1 万目标应优先现金流和可交付性。","source":"knowledge/packs/playbooks.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["route","first-revenue"],"routes":["consulting","knowledge","service"],"stage":["first-revenue"],"risk":["execution","delivery"],"type":"playbook","confidence":"medium"}
{"id":"opc_2026_0032","knowledge":"个人 IP 不是产品；如果不知道卖什么，先找可付费结果，而不是继续做人设。","original":"个人 IP 断点常在产品定义和成交承接。","source":"knowledge/packs/content-commerce.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["personal-ip","offer"],"routes":["content","knowledge","consulting"],"stage":["idea","validation"],"risk":["execution"],"type":"anti_pattern","confidence":"high"}
{"id":"opc_2026_0033","knowledge":"国外 indie hacker 案例不能照搬到国内；支付、渠道、语言、文化、平台和合规都需要迁移评估。","original":"国外资源地图只能提供结构，不能直接变成国内判断。","source":"https://github.com/johackim/awesome-indiehackers","source_type":"case","date_checked":"2026-05-11","topics":["benchmark","indie-hacker"],"routes":["software","content"],"stage":["idea","validation"],"risk":["platform","payment","policy"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0034","knowledge":"Pieter Levels 可复制的不是多开项目本身，而是低开销、公开发布、快速验证和长期复利。","original":"公开 indie hacker 案例的结构化拆解。","source":"https://github.com/johackim/awesome-indiehackers","source_type":"case","date_checked":"2026-05-11","topics":["benchmark","indie-hacker"],"routes":["software"],"stage":["idea"],"risk":["execution"],"type":"case","confidence":"medium"}
{"id":"opc_2026_0035","knowledge":"Marc Lou 类案例可学习的是高速 shipping 和清晰小工具定位，但不能忽略其受众、渠道和英语市场差异。","original":"公开 indie hacker 案例的迁移风险拆解。","source":"https://github.com/johackim/awesome-indiehackers","source_type":"case","date_checked":"2026-05-11","topics":["benchmark","software"],"routes":["software"],"stage":["idea","validation"],"risk":["acquisition","platform"],"type":"case","confidence":"medium"}
{"id":"opc_2026_0036","knowledge":"Justin Welsh 类内容商业可学习的是内容到 offer 的系统，而不是简单模仿人设和表达风格。","original":"solo creator business 常见可复制部分是内容栏目、产品阶梯和邮件/私域承接。","source":"https://github.com/johackim/awesome-indiehackers","source_type":"case","date_checked":"2026-05-11","topics":["benchmark","content"],"routes":["content","knowledge"],"stage":["acquisition"],"risk":["trust","execution"],"type":"case","confidence":"medium"}
{"id":"opc_2026_0037","knowledge":"Arvid Kahl 类案例强调先理解受众和问题，再围绕受众建设产品与内容。","original":"公开 indie hacker 资源中的 audience-first 方法论。","source":"https://github.com/johackim/awesome-indiehackers","source_type":"case","date_checked":"2026-05-11","topics":["benchmark","audience"],"routes":["software","content"],"stage":["idea","validation"],"risk":["execution"],"type":"case","confidence":"medium"}
{"id":"opc_2026_0038","knowledge":"EasyChen 的一人公司方法论可作为研究参考，但其 CC-BY-NC-SA 内容不能直接商业化搬运。","original":"该项目使用 CC-BY-NC-SA 许可；商业产品必须建立自己的表达和来源体系。","source":"https://github.com/easychen/one-person-businesses-methodology","source_type":"case","date_checked":"2026-05-11","topics":["license","benchmark"],"routes":["all"],"stage":["idea"],"risk":["legal"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0039","knowledge":"dbskill 可学习原子库、多 skill 路由和反空话诊断，但不能复制其内容、品牌或个人风格。","original":"dbskill 结构启发：原子库、路由、诊断 skill 和内容工具箱。","source":"https://github.com/dontbesilent2025/dbskill","source_type":"case","date_checked":"2026-05-11","topics":["benchmark","skill-design"],"routes":["all"],"stage":["idea"],"risk":["legal","positioning"],"type":"case","confidence":"high"}
{"id":"opc_2026_0040","knowledge":"公开项目适合作为研究来源，不适合直接当作商业产品内容库。","original":"用户已确认允许引入公开项目作为研究来源，但不直接复制内容。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["research","license"],"routes":["all"],"stage":["idea"],"risk":["legal"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0041","knowledge":"小程序不一定比网页更适合早期验证；它提升微信生态信任，也增加审核、开发和主体成本。","original":"小程序属于国内生态权衡，不应作为默认起点。","source":"knowledge/packs/china-realities.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["wechat","mini-program","validation"],"routes":["software"],"stage":["validation","launch"],"risk":["platform","ops"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0042","knowledge":"官网重要性取决于阶段；验证期官网通常不是核心，长期品牌和搜索承接才更需要官网。","original":"官网不是第一性原理，商业闭环才是。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["website","validation"],"routes":["software","content","service"],"stage":["validation","launch"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0043","knowledge":"跨境英文产品要同时评估英语表达、支付、获客渠道、支持时区和信任来源，而不是只看国外客单价。","original":"国外案例迁移到跨境产品时的主要约束。","source":"knowledge/packs/benchmark-framework.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["cross-border","benchmark"],"routes":["software","content"],"stage":["idea","validation"],"risk":["payment","trust","execution"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0044","knowledge":"一人公司不应同时开多个渠道；先找到一个能稳定带来买家的渠道，再扩展。","original":"可重复获客阶段不该同时做多个平台。","source":"knowledge/packs/principles.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["acquisition","focus"],"routes":["all"],"stage":["acquisition"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0045","knowledge":"重交付是很多一人公司收入上升后崩掉的原因；交付系统化要早于规模化。","original":"交付系统化阶段的主问题是降低交付和客服成本。","source":"knowledge/packs/principles.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["delivery","scale"],"routes":["knowledge","consulting","service"],"stage":["delivery"],"risk":["delivery","ops"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0046","knowledge":"复购不是锦上添花；没有持续购买理由的一人公司会长期陷入获客压力。","original":"复购/持续性是一人公司成立概率公式中的乘数。","source":"knowledge/packs/principles.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["retention","profit"],"routes":["all"],"stage":["profit"],"risk":["acquisition","cashflow"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0047","knowledge":"毛利低且客服高的产品不适合一人公司，除非能通过自动化、模板或明确边界压低交付。","original":"一人公司必须避免低毛利高客服。","source":"knowledge/packs/principles.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["margin","support"],"routes":["all"],"stage":["profit","delivery"],"risk":["delivery","ops"],"type":"constraint","confidence":"high"}
{"id":"opc_2026_0048","knowledge":"用户访谈如果阻力太高，可以降级为 3 个目标用户、3 个问题、1 个付费假设。","original":"低阻力验证 playbook。","source":"knowledge/packs/playbooks.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["validation","execution"],"routes":["all"],"stage":["validation"],"risk":["execution"],"type":"playbook","confidence":"high"}
{"id":"opc_2026_0049","knowledge":"今天只做一件事的动作比 10 条建议更有价值，尤其对执行阻力高的创始人。","original":"用户明确指出大多数人不会做复杂用户访谈，需要更低阻力版本。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["execution","answer-style"],"routes":["all"],"stage":["validation"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0050","knowledge":"停损条件是产品答案的一部分；没有停损，建议会变成无限坚持。","original":"回答协议要求明确暂停、换方向或降级方案的信号。","source":"knowledge/packs/quality-rubric.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["stop-loss","answer-style"],"routes":["all"],"stage":["all"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0051","knowledge":"医疗、金融、教育、赚钱类内容和夸大案例需要更保守表达，避免承诺确定结果。","original":"国内内容合规坑位包括医疗、金融、教育、赚钱类内容、案例夸大和虚假承诺。","source":"knowledge/packs/china-realities.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["content-compliance","platform"],"routes":["content","knowledge"],"stage":["launch","risk"],"risk":["policy","platform"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0052","knowledge":"诱导分享、外链、私信引流等平台动作不能只看转化效果，也要看账号和链路风险。","original":"微信、小红书、抖音等平台规则会影响转化路径。","source":"knowledge/packs/china-realities.md","source_type":"market_observation","date_checked":"2026-05-11","topics":["platform","conversion"],"routes":["content","private-domain"],"stage":["acquisition"],"risk":["platform"],"type":"constraint","confidence":"medium"}
{"id":"opc_2026_0053","knowledge":"一人公司路线选择不是兴趣排序，而是看哪条路线最先形成现金流、信任和低维护交付。","original":"路线类型包括软件、AI 服务、知识产品、咨询产品化、内容 IP、私域卖货和本地轻服务。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["route","strategy"],"routes":["all"],"stage":["idea"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0054","knowledge":"失败案例也要入库；做完没人买、涨粉不变现、低价交付拖死，比成功故事更能保护用户。","original":"案例库必须包含失败案例，用于 stop-loss 和反模式判断。","source":"docs/superpowers/specs/2026-05-11-one-person-company-skill-system-design.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["case-library","failure"],"routes":["all"],"stage":["all"],"risk":["execution"],"type":"principle","confidence":"high"}
{"id":"opc_2026_0055","knowledge":"回答要简洁不是少思考，而是把复杂判断压缩成一个主判断、两条路和一个下一步。","original":"输出风格要求最多一个主判断、两个可选路径、一个下一步。","source":"knowledge/packs/quality-rubric.md","source_type":"founder_note","date_checked":"2026-05-11","topics":["answer-style","rubric"],"routes":["all"],"stage":["all"],"risk":["execution"],"type":"rubric","confidence":"high"}
```

- [ ] **Step 3: Run validation and verify atom-related errors are gone**

Run:

```powershell
npm run opc:validate
```

Expected: validation still fails only for incomplete `skills/*/SKILL.md` and missing pressure question/scoring files.

---

### Task 5: Replace Generated Skill Bodies

**Files:**

- Modify: `skills/opc/SKILL.md`
- Modify: `skills/opc-diagnosis/SKILL.md`
- Modify: `skills/opc-content/SKILL.md`
- Modify: `skills/opc-benchmark/SKILL.md`
- Modify: `skills/opc-china-reality/SKILL.md`

- [ ] **Step 1: Replace `skills/opc/SKILL.md`**

Content:

```markdown
---
name: opc
description: Main router for 一人公司内参, a Chinese one-person company business judgment toolbox. Use when the user asks about solo company direction, business viability, self-media monetization, AI product ideas, offer design, domestic China startup pitfalls, ICP/hosting/payment/entity/platform tradeoffs, or asks to diagnose a one-person business project.
---

# OPC Router

## Workflow

1. Read `knowledge/packs/principles.md`.
2. Classify the user request:
   - viability or stuck project: use `opc-diagnosis`
   - content, Xiaohongshu, Douyin, public account, personal IP: use `opc-content`
   - case, benchmark, "learn from who", foreign-to-China migration: use `opc-benchmark`
   - ICP, hosting, payment, entity, private domain, platform rules: use `opc-china-reality`
3. If more than one applies, answer through the highest-risk lens first:
   - policy/payment/platform risk
   - commercial viability
   - acquisition/content
   - benchmark
4. Produce a concise answer with:
   - one main judgment
   - the broken variable in the one-person-company formula
   - tradeoff
   - one low-resistance next action
   - stop-loss condition

## Required Knowledge

Use shared knowledge from:

- `knowledge/packs/principles.md`
- `knowledge/packs/quality-rubric.md`
- `knowledge/packs/anti-patterns.md`
- `knowledge/atoms/atoms.jsonl`

## Style

Answer in Chinese unless the user asks otherwise.

Be concise, concrete, and commercially grounded. Do not perform harshness. Do not use generic startup words as conclusions.

## Guardrails

- Do not fabricate cases, revenue, platform rules, or policy claims.
- Mark policy/payment/platform information as time-sensitive.
- Do not tell the user to file ICP, build MVP, do private domain, or keep posting unless that phrase is converted into a concrete low-resistance action.
- Do not delete or alter the old Book of Elon project unless the user explicitly asks for an implementation step and the retirement inventory has been reviewed.
```

- [ ] **Step 2: Replace `skills/opc-diagnosis/SKILL.md`**

Content:

```markdown
---
name: opc-diagnosis
description: Diagnose one-person company business viability, bottlenecks, pricing, offer, first revenue, delivery burden, and whether a project should continue, pause, or pivot. Use when the user asks if an idea can work, why nobody buys, what route to choose, or how to make a solo business profitable.
---

# OPC Diagnosis

## Workflow

1. Read `knowledge/packs/principles.md`.
2. Read `knowledge/packs/diagnosis-framework.md`.
3. Search `knowledge/atoms/atoms.jsonl` for matching topics, stage, route, and risk.
4. Identify the stage: idea, validation, first-revenue, acquisition, delivery, profit, or risk.
5. Identify the broken variable:
   demand, reach, trust, pricing, margin, delivery, retention, risk, or founder friction.
6. Give one main judgment, not a list of ideas.
7. Offer two paths only when there is a real tradeoff.
8. End with one low-resistance next action and one stop-loss condition.

## Output Shape

```text
主判断：

断点：

为什么：

两条路：

下一步：

停损：
```

## Required Knowledge

- `knowledge/packs/principles.md`
- `knowledge/packs/diagnosis-framework.md`
- `knowledge/packs/playbooks.md`
- `knowledge/packs/quality-rubric.md`
- `knowledge/atoms/atoms.jsonl`

## Diagnosis Rules

- If the user has no paid signal, do not recommend heavy product building.
- If the user has praise but no payment, diagnose trust, offer, and payment path.
- If the user has revenue but exhaustion, diagnose delivery debt and pricing.
- If the user has traffic but no conversion, route to content-commerce logic.
- If domestic hosting, payment, entity, or platform risk appears, include `opc-china-reality` logic.
```

- [ ] **Step 3: Replace `skills/opc-content/SKILL.md`**

Content:

```markdown
---
name: opc-content
description: Diagnose Chinese self-media and content-commerce for one-person companies, including Xiaohongshu, Douyin, WeChat public accounts, personal IP, content-to-offer conversion, private-domain handoff, follower growth without revenue, and AI content matrix risk.
---

# OPC Content

## Workflow

1. Read `knowledge/packs/content-commerce.md`.
2. Read `knowledge/packs/principles.md`.
3. Search `knowledge/atoms/atoms.jsonl` for topics: content, xiaohongshu, douyin, wechat, private-domain, trust, conversion.
4. Classify the content job:
   reach, trust, screening, conversion, private-domain, or retention.
5. Identify whether the content serves a real product or only an identity.
6. Diagnose platform constraint and commercial bottleneck.
7. Give one content experiment that can produce a buying signal.

## Required Knowledge

- `knowledge/packs/content-commerce.md`
- `knowledge/packs/china-realities.md`
- `knowledge/packs/quality-rubric.md`
- `knowledge/atoms/atoms.jsonl`

## Output Rules

- Do not end with "持续输出", "打造个人品牌", "多发小红书", or "做私域".
- Convert platform advice into a concrete test.
- If private domain is recommended, name the service load and account-risk cost.
- If the user has followers but no revenue, diagnose offer, trust, and conversion path before follower count.

## Example Judgment

```text
你现在不是粉丝少，是内容没有承接到一个可购买结果。先别换平台，把最近 10 条内容改成同一个买家、同一个结果、同一个私信入口，测有没有人问价格。
```
```

- [ ] **Step 4: Replace `skills/opc-benchmark/SKILL.md`**

Content:

```markdown
---
name: opc-benchmark
description: Deconstruct domestic and foreign one-person company, indie hacker, creator business, AI tool, knowledge product, and productized consulting cases. Use when the user asks who to learn from, whether a model can be copied in China, or wants case-backed business judgment.
---

# OPC Benchmark

## Workflow

1. Read `knowledge/packs/benchmark-framework.md`.
2. Read `knowledge/packs/case-library.md`.
3. Search `knowledge/atoms/atoms.jsonl` for source_type `case` and matching route.
4. Split every case into:
   - public fact
   - inference
   - copyable part
   - non-copyable part
   - China migration risk
5. Use cases to support judgment, not to decorate the answer.

## Required Knowledge

- `knowledge/packs/benchmark-framework.md`
- `knowledge/packs/case-library.md`
- `knowledge/packs/china-realities.md`
- `knowledge/atoms/atoms.jsonl`

## Output Rules

- Never invent revenue, conversion rates, or private founder details.
- If the case is foreign, include payment, channel, language, culture, platform, and compliance migration risk.
- If the case is domestic but weakly sourced, label it as market observation.
- End with what the user should copy and what they should not copy.

## Case Mini-Template

```text
可学：
不可学：
迁移风险：
对你的判断：
```
```

- [ ] **Step 5: Replace `skills/opc-china-reality/SKILL.md`**

Content:

```markdown
---
name: opc-china-reality
description: Handle China-specific solo business constraints and tradeoffs: ICP filing, mainland vs Hong Kong hosting, WeChat/Alipay payment, personal collection, company entity, tax direction, WeChat ecosystem, Xiaohongshu/Douyin platform rules, private-domain risk, content compliance, and server/payment/platform decisions.
---

# OPC China Reality

## Workflow

1. Read `knowledge/packs/china-realities.md`.
2. Search `knowledge/atoms/atoms.jsonl` for topics matching hosting, ICP, payment, entity, WeChat, Xiaohongshu, Douyin, private-domain, or compliance.
3. Identify whether the user is in validation, first revenue, launch, or risk governance.
4. Give the stage-appropriate tradeoff.
5. Mark time-sensitive rules and recommend checking official docs before action.
6. Do not give legal, tax, or compliance final advice.

## Required Knowledge

- `knowledge/packs/china-realities.md`
- `knowledge/packs/principles.md`
- `knowledge/packs/quality-rubric.md`
- `knowledge/atoms/atoms.jsonl`

## Output Rules

- Avoid single-path answers like "去备案" or "接入支付".
- Always explain what the choice buys and what it costs.
- For ICP, separate validation needs from long-term domestic operation.
- For payment, separate first payment signal from scalable merchant operations.
- For entity and tax, provide direction-level guidance and professional-review reminder.

## Example Judgment

```text
如果你还没证明有人愿意付费，备案不是第一优先级。先用低摩擦承接页验证付款意愿；等稳定成交后，再把主体、备案、支付和长期域名一起规划。
```
```

- [ ] **Step 6: Run validation and verify skill errors are gone**

Run:

```powershell
npm run opc:validate
```

Expected: validation still fails only for missing pressure question/scoring files.

---

### Task 6: Add Pressure Questions And Scoring Sheet

**Files:**

- Create: `knowledge/evals/pressure-questions.md`
- Create: `knowledge/evals/scoring-sheet.md`

- [ ] **Step 1: Create `knowledge/evals/pressure-questions.md`**

Content:

```markdown
# Pressure Questions

| # | Question | Must Hit |
|---:|---|---|
| 1 | 我做了一个 AI 工具，发出去没人用，是不是该放弃？ | diagnose demand/reach/trust before features; one low-friction paid-signal test |
| 2 | 我想做一个一人公司，但不知道选 AI 工具、知识付费还是自媒体。 | compare routes by cashflow, trust, delivery, maintenance |
| 3 | 我想做官网，是不是要先备案？ | validation vs long-term operation; ICP tradeoff; official-doc caveat |
| 4 | 香港服务器是不是更适合一人公司早期验证？ | lower friction vs speed/trust/platform; stage-specific answer |
| 5 | 我想接微信支付，但没有公司主体怎么办？ | first revenue signal vs scalable merchant ops; entity risk |
| 6 | 我做小红书半年有 3000 粉丝，但没有收入，问题在哪？ | content job, offer, conversion path; not follower count |
| 7 | 我做知识付费，应该卖 99 还是 199？ | pricing by result, trust, delivery cost, refund risk |
| 8 | 我想做一个创业陪跑社群，怎么避免交付把自己拖死？ | scope boundary, productized diagnosis, service-load control |
| 9 | 我想做 AI 自动化服务，怎么避免变成外包？ | limit scope, inputs/outputs, modification count, maintenance |
| 10 | 我有一个 SaaS 想法，但我没有流量，应该先做产品还是先做内容？ | reach and payment signal before heavy build |
| 11 | 我不想露脸，能不能做自媒体变现？ | alternate trust evidence; cases/process/results |
| 12 | 我想做个人 IP，但不知道卖什么。 | IP is not product; define paid result |
| 13 | 我看到国外 indie hacker 做得很好，国内能不能照搬？ | migration risk: payment, channel, language, culture, compliance |
| 14 | 我想做小程序，会不会比网页更适合国内用户？ | trust/ecosystem vs review/dev/entity cost |
| 15 | 我现在每月只想赚 1 万，应该选什么路线？ | cashflow-first route; high-trust service/diagnostic/template |
| 16 | 我有技术能力，但不会销售，怎么做一人公司？ | offer clarity before sales system |
| 17 | 我想卖提示词/智能体，这个方向还有没有机会？ | workflow/data/result/channel; avoid pure prompt commodity |
| 18 | 我做了很多功能，但用户不付费，怎么办？ | cut to one paid result; diagnose trust/offer/reach |
| 19 | 我想做跨境英文产品，但英语和支付都不熟，值得吗？ | assess English, payment, support, channel, trust |
| 20 | 我想用 AI 做内容矩阵，会不会被平台限流？ | platform risk, quality, trust, account operations |
```

- [ ] **Step 2: Create `knowledge/evals/scoring-sheet.md`**

Content:

```markdown
# Scoring Sheet

Use this sheet to manually score answers to `pressure-questions.md`.

| Dimension | Points | Evidence Required |
|---|---:|---|
| Commercial essence | 2 | names the broken business variable |
| Domestic reality | 2 | includes China-specific constraints when relevant |
| Case or atom grounding | 1.5 | uses a case, source, atom, or explicit observation |
| Route planning | 1.5 | identifies stage and viable path |
| Executability | 1.5 | gives one low-resistance action |
| Expression | 1 | concise and direct |
| Uncertainty | 0.5 | marks time-sensitive or unverified rules |

## Pass Rule

- 8+ average across 20 pressure questions.
- No answer may fabricate sources or cases.
- Any answer that ends with generic advice as the conclusion fails that question.

## Evaluation Procedure

1. Ask the baseline model each pressure question without loading this skill.
2. Ask the skill-enabled model each pressure question.
3. Score both using the same rubric.
4. Record gaps by dimension.
5. Improve packs or atoms before changing tone.
```

- [ ] **Step 3: Run validation and verify it passes**

Run:

```powershell
npm run opc:validate
```

Expected: `OPC knowledge validation passed.`

- [ ] **Step 4: Commit**

```powershell
git add skills knowledge package.json scripts/opc/validate-knowledge.js
git commit -m "feat(opc): add one-person company skill toolbox"
```

---

### Task 7: Add Book Of Elon Retirement Inventory

**Files:**

- Create: `docs/superpowers/audits/2026-05-11-book-of-elon-retirement-inventory.md`

- [ ] **Step 1: Create the local retirement inventory**

Content:

```markdown
# Book of Elon Retirement Inventory

Date: 2026-05-11

Scope: local repository only. This document does not authorize any server deletion.

## Decision

Original Book of Elon product is abandoned as the main direction. The new direction is 一人公司内参.

## Preserve For Learning

| Path | Reason |
|---|---|
| `docs/runbooks/incident-cost-spike.md` | API cost-control lessons |
| `docs/superpowers/plans/2026-04-28-paywall-onboarding.md` | pricing and paywall lessons; do not execute as-is |
| `docs/superpowers/decisions/2026-04-27-toy-mode-and-paywall.md` | prior product decision context |
| `docs/ARCHITECTURE.md` | architecture reference for old app |
| `tests/smoke/cost-control.js` | cost-control testing reference |
| `services/` | reference only for old API/service boundaries |
| `auth/` | reference only for old auth and quota patterns |

## Retire From New Product Path

| Path | Reason |
|---|---|
| `The Book of Elon A Guide to Purpose and Success.pdf` | old brand/content dependency |
| `The Book of Elon.epub` | old brand/content dependency |
| `prompts/` | review later; remove Elon-specific positioning before reuse |
| `web/` | old frontend; do not modify until skill quality passes pressure tests |
| `server.js` | old runtime; do not modify until product path is confirmed |
| `nginx.book-of-elon.conf.example` | old deployment reference only |

## Server Safety Rules

No server action is allowed until a separate server inventory lists:

- absolute project directory
- PM2 process name and id
- port
- domain
- Nginx site file
- database files
- environment files
- log files
- backup destination
- other projects on the same host

## Forbidden Actions

- no global recursive deletion
- no deletion of unowned Nginx, PM2, database, log, or env files
- no path guessing
- no cleanup for neatness
- no server change without backup and owner review
```

- [ ] **Step 2: Verify the inventory does not propose direct deletion**

Run:

```powershell
Select-String -Path .\docs\superpowers\audits\2026-05-11-book-of-elon-retirement-inventory.md -Pattern 'Remove-Item|rm -rf|delete server|删除服务器'
```

Expected: no output.

- [ ] **Step 3: Commit**

```powershell
git add docs/superpowers/audits/2026-05-11-book-of-elon-retirement-inventory.md
git commit -m "docs(opc): add book of elon retirement inventory"
```

---

### Task 8: Final Verification

**Files:**

- Verify all files from this plan.

- [ ] **Step 1: Run validation**

Run:

```powershell
npm run opc:validate
```

Expected:

```text
OPC knowledge validation passed.
```

- [ ] **Step 2: Run git whitespace checks**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Inspect current status**

Run:

```powershell
git status --short --branch
```

Expected: clean working tree after the task commits.

- [ ] **Step 4: Summarize implementation**

Report:

- skill folders created
- knowledge packs created
- atom count
- validation command result
- retirement inventory created
- no server or old runtime files modified

---

## Self-Review Checklist

- Spec coverage: five v0.1 skills, packs, atoms, pressure questions, rubric, and retirement inventory are all represented.
- Incomplete-marker scan: no generated template markers should remain in created files after Task 6.
- Type consistency: atom fields match `validate-knowledge.js` and `atom.schema.json`.
- Safety: no server deletion or old runtime deletion appears in any executable step.
- Verification: `npm run opc:validate` is the core pass/fail gate.
