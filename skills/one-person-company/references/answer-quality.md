# Answer Quality

Use this reference before writing final answers. The goal is not a sharper tone. The goal is higher evidence density.

## Non-Negotiable Standard

Every useful answer must contain:

1. **Hard judgment**: say whether the idea is worth doing, worth narrowing, or should stop.
2. **Competitor layering**: separate direct competitors, adjacent substitutes, free substitutes, and high-price alternatives.
3. **Payment mechanism**: explain how comparable products or paths actually charge.
4. **Evidence boundary**: state what the evidence proves and what it does not prove.
5. **Local execution constraint**: mention platform, payment, hosting, ICP, WeChat, invoice, trust, or delivery friction when relevant.
6. **Numeric next action**: include a number, price, time window, user count, or pass/fail threshold.
7. **Stop-loss line**: define what result means pause, narrow, or kill.

## Competitor Layering

Do not casually list names. Classify each one:

- **直接竞品**: products built mainly for the same job.
- **相邻替代**: tools or workflows users can use to route around the problem.
- **免费替代**: free tools, open-source libraries, templates, scripts, built-in features, or manual workflows.
- **高价替代**: agencies, consultants, enterprise software, private deployment, or API platforms.

For each competitor or pattern, answer:

- What job does it solve?
- Who pays?
- What is the payment mechanism?
- What advantage does it have?
- What does it prove?
- What does it not prove?

## Payment Mechanism

Never say "market has products" without saying how money moves.

Common mechanisms:

- One-time license or buyout.
- Subscription by seat, site, export count, usage, or advanced feature.
- API credits, concurrency, file size, SLA, security, or enterprise support.
- Template, course, report, data slice, paid community, or consultation.
- Service fee, audit fee, diagnostic fee, implementation fee, or retainer.
- White-label, custom CSS, private deployment, invoice, compliance, or team workflow.

## Evidence Boundary

Never turn weak evidence into a strong conclusion.

Examples:

- GitHub stars prove attention, not payment.
- Free users prove interest, not willingness to pay.
- Overseas products prove a mechanism may exist, not local fit.
- A direct competitor proves budget may exist, not that a clone can win.
- A tool supporting a related export/import flow proves substitution risk, not direct competition.
- A user saying "sounds useful" proves politeness, not buying intent.

## Product Judgment Shape

```text
判断：能做 / 谨慎做 / 不建议做

为什么：
- 用户现在为什么会付钱：
- 直接竞品：
- 相邻替代：
- 免费替代：
- 高价替代：
- 收费机制：
- 证据边界：

一人公司切口：
- 第一版卖什么结果：
- 第一批用户从哪里来：
- 第一单怎么收钱：

7 天验证：
- 今天做什么：
- 合格标准：
- 停损线：
```

## Bad Answer Pattern

错误示例:

```text
可以先做 MVP，找到目标用户，持续优化体验，打造差异化。
```

Why it fails:

- No direct competitor.
- No payment mechanism.
- No evidence boundary.
- No numeric action.
- No stop-loss.

## Good Answer Pattern

合格示例:

```text
这个方向不能直接按“Markdown 转 HTML 小工具”做。

直接竞品是 Marked 2、Markdown Monster、MDCode.io、ConvertAPI MD to HTML、CloudConvert MD to HTML。
相邻替代是编辑器导出、文档站生成器、CMS、邮件编辑器。
免费替代是 Pandoc、VS Code 插件、开源库和免费在线转换站。

收费机制不是“转 HTML”，而是桌面预览、批量导出、Custom CSS、模板、API credits、SLA、团队协作或私有化。

证据边界：这些竞品证明 Markdown 发布/转换工作流有付费空间，不证明一个普通粘贴转换网页可以订阅收费。

7 天验证：做 3 个 demo，找 15 个正在写文档的人，问是否愿意为批量/API/品牌样式付 19-99 元/月或 299-999 元一次性服务费。
停损线：15 人里没有 3 个给真实 Markdown 文件或愿意付费，就不要做通用转换器。
```

## Source Discipline

不能把不确定事实写成确定事实。If unsure whether a named product supports a specific feature, say "需要核验" or omit it. Do not use famous products as decorative proof.
