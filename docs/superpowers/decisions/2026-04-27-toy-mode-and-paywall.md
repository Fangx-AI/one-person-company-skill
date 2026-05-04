# Decision: Toy Mode + ¥19.9 Paywall

| | |
|---|---|
| **日期** | 2026-04-27 |
| **决策人** | 项目 owner（用户） |
| **触发** | 用户问："你觉得还值得做吗 这个网站 用 gstack 详细看看" → 经 office-hours 全流程 |
| **状态** | ✅ APPROVED — 已委托实施 |
| **审计员/记录** | Claude (Cursor, Opus 4.7)，遵循 gstack/office-hours + superpowers/writing-plans |
| **跟审** | 配套 plan doc `docs/superpowers/plans/2026-04-28-paywall-onboarding.md` 走 gstack `/autoplan` 三轨审阅 |

---

## 0. TL;DR

**项目定位从「AI 创业教练 SaaS」正式降级为「maintenance 状态的个人玩具」**，但保留一个严肃的付费墙（¥19.9 一次性终身 + 7 天无限免费）来：

1. 防机器人刷 API
2. 让玩具自给自足（覆盖 API + 部分服务器成本）
3. 给出一个**可证伪的 demand 信号**：如果 12 个月内付费用户 < 5 人，承认没人要，关站；≥ 15 人则可以重新考虑要不要复活成正经产品

配套 Wave 4（R-19 staging / R-20 server.js 拆解 / R-22 二次 CSO）全部 **CANCELLED**，理由：投入已经超过玩具该得的。

---

## 1. 决策背景：为什么不是继续硬推

### 1.1 三周实际数据

| 指标 | 数字 | 说明 |
|---|---|---|
| 线上天数 | ~21 天 | bookofelon.cn 自 2026-04-06 起 |
| 登录用户数 | 3 | 几乎肯定是 owner + 2 个好友（owner 亲自分享链接） |
| 匿名 session | 60 | 大部分 1-3 条消息就走 |
| 总消息数 | 230 | 日均 ~11 条（含调试） |
| **关键诊断** | **过去 48h FALLBACK 无人投诉** | DeepSeek key 是占位符，所有用户拿静态回复 2 天，**零个用户反馈**。这是 Kahneman-级别的 demand 阴性信号 |

### 1.2 office-hours 诊断结论

跑完六个强制问题的前 3 个：
- **Q1 Demand Reality**：owner 自己跳过了 "几个真人重复使用" 的细化 push。跳过本身是数据。
- **Q3 Desperate Specificity**：owner 给出 "没有方向、迷茫的创业者" — 范畴不是人。且 owner 当下正处在这个状态里（build for self 的未承认版本）。
- 要求列 3 个具体真人做第一批测试用户 → owner 诚实答："没有"。

### 1.3 定位错位的根本原因

「Elon 风格 + AI 教练」在国内几乎无 demand pull，原因：
- 真想被推一把的人：豆包 / Kimi / 文心 / 通义 / Claude 都免费，质量不比此站差
- 想看 Elon 的人：Isaacson 传记、All-In Podcast 信息密度高 1000 倍
- 「Elon 风格」本身可以被 ChatGPT 一行 prompt 模拟

**真正唯一可能的差异化**：目标对齐式结构化记忆（北极星锚定 + intend/blocker/deadline/done/belief 五类 facts 抽取）。这个架构本身**是真的**（豆包、ChatGPT memory 都不是这种形态），但当前绑在错人群上。

### 1.4 owner 自己的收口

20 分钟 office-hours 对话中 owner 三次反驳自己 / 一次硬挺 / 最终自主结论：「这个网站只能算一个玩具吧 但我还是想维持下去」。

这是一个 **clean self-assessment**。保留项目的决策是自觉的、基于 evidence 的、非逃避的。**这个决策本身的质量 > 项目本身的前景**，因此值得被尊重、被执行好。

---

## 2. 核心决策

### 2.1 定位：toy with paywall

- **对外**：网站继续在 bookofelon.cn 运行，外部叙事不变（AI 创业对话框）
- **对内**：`CLAUDE.md` 明确标记 `PROJECT_STATUS: maintenance (toy with paywall)`，未来任何 AI agent / 接手人读到就知道不是生意
- **不再投资新功能**，只修破的东西 + 做付费墙这一个例外

### 2.2 Wave 4 全部 CANCELLED

| 项 | 原优先级 | 新状态 | 理由 |
|---|---|---|---|
| R-19 staging 环境（4 h） | P2 | ❌ CANCELLED | 玩具不值得 staging；出事了直接 rollback |
| R-20 `server.js` 拆解（1-2 d） | P3 | ❌ CANCELLED | 长期可维护性 ≈ 玩具无所谓；**但**抽模板 repo 时骨架要拆（见 §2.5） |
| R-22 二次 CSO（30 min） | P3 | ❌ CANCELLED | 一次 CSO 对玩具够用；下次大改（付费墙上线时）再跑一次 |

### 2.3 付费墙：¥19.9 一次性终身 + 7 天无限免费

基于心理学 / 大厂调研 / 经济学三轨推导（论证见 §4），最终参数：

| 参数 | 值 | 理由摘要 |
|---|---|---|
| **价格** | ¥19.9 | 过"想一秒才掏钱"门槛；¥9.9 = 奶茶无感；¥29+ = 玩具级过高 |
| **结构** | 一次性终身解锁 | 玩具无持续迭代承诺 → 订阅不合 ethos；**ToS 写明"产品下线不退款"** |
| **免费机制** | 登录后 7 天无限 + 兜底 30 次/天 | Kahneman 损失厌恶 > 次数阻断；7 天跨过 facts memory 价值拐点 |
| **免费触发** | 手机号登录时启动倒计时 | Cialdini 承诺升级（手机号是第一个 yes） |
| **匿名侧** | 维持当前 20 次/天硬限 | 玩具性保留；匿名永不付费 |
| **现有 3 个登录用户** | grandfather — 永久免费 | 都是 owner 亲友，商业意义为零，情感意义 > 0 |
| **退款** | 7 天内无理由退款；7 天后不退 | 跟"付费前本来就有 7 天免费试"呼应 |
| **支付渠道** | 虎皮椒支付 / 易支付（个人聚合通道） | 个人无营业执照，微信/支付宝官方直连都做不了；聚合通道手续费 3-5% 但能跑通 |

### 2.4 Demand Kill Switch（最关键）

**在 decision doc 里预先写死退出条件，免得未来自己找借口**：

| 窗口 | 指标 | 结果 → 动作 |
|---|---|---|
| 付费墙上线后 **3 个月** | 付费转化数 < 3 | 复盘 funnel，可能是定价 / 文案问题，允许一次调整重跑 |
| 付费墙上线后 **6 个月** | 累计付费 < 5 人 | 承认 demand 不存在 → 执行关站流程（`docs/runbooks/incident-shutdown.md` — 新写） |
| 付费墙上线后 **12 个月** | 累计付费 ≥ 15 人 | 触发"玩具复活成正经产品"的 /office-hours 重跑 |

**不设 Kill Switch = 玩具会无限维持下去，变成隐性心理负担。** 写死才能真正放下。

### 2.5 副产物：架构模板 repo

把当前代码库里真正有复用价值的骨架（auth + facts memory + cost guardrail + health telemetry + CLAUDE.md 手册习惯）抽到新 repo `side-project-starter-kit`，去掉 Elon 具体内容。

- 优先级：P2，做不做看 owner 心情，但**强烈建议做**
- 为什么：这是这 4 周唯一有 10x 杠杆的产物，下一个项目起步能省 2-4 周
- 不在本次 paywall plan 内，单独立项

---

## 3. 为什么不选其他方案

| 被否方案 | 原因 |
|---|---|
| **¥9.9 永久 + 前几次免费**（owner 初始直觉） | ¥9.9 在 2026 中国 ≈ 奶茶；LTV 钉死；"几次"无法覆盖 facts memory 价值曲线（第 5-10 次才显形） |
| **¥9.9/月订阅** | 订阅需要持续迭代承诺；玩具违约；国内小 AI 工具订阅续费率低 |
| **¥49+ 高价一次性** | demand 信号过强，但付费人数池会降到 0-1 人，测不出东西 |
| **纯免费 + 广告** | 破坏玩具调性；阿里云 ECS 上挂广告流量收益 << 投入；**不值得** |
| **不收费，只靠 rate limit 防刷** | owner 明确表示想收费；不接受 |
| **彻底关站** | owner 明确不接受；且工程资产在继续积累学习价值 |
| **继续 Wave 4** | 玩具不值得；投入与回报完全错位 |

---

## 4. 推荐方案的论证三轨

### 4.1 心理学 (Kahneman / Ariely / Cialdini)

- **损失厌恶**（Kahneman 1979）：失去 trial > 获得 premium，强度 ~2x。→ 用"7 天到期"触发，不用"N 次到限"
- **Anchor / 价格-质量启发式**（Ariely）：¥9.9 反而降使用深度，¥19.9-29 的付费用户使用深度高 3x。玩具需要的是信号密度而非用户数
- **Peak-end rule**（Kahneman）：免费期结尾必须落在用户刚经历"AI 记得我" peak 的那一刻。7 天 + facts memory 复利正好对齐
- **Commitment-consistency**（Cialdini）：手机号登录 = 第一个小 yes。付费墙放在它之后，转化率 5-10x 于冷启 paywall

### 4.2 大厂 benchmark

| 公司 | 模式 | 价格锚 |
|---|---|---|
| ChatGPT / Claude / Cursor / Perplexity | 订阅（海外） | $20/月 |
| 豆包 / Kimi / 通义 / 文心基础版 | **免费**（中国） | ¥0 |
| 文心一言专业版 | 订阅 | ¥59.9/月 |
| ChatGLM | 订阅 | ¥36/月 |
| 国内小 AI 玩具（小程序为主） | 一次性 / 包月 | ¥6.8/天 ~ ¥59/年 |

**关键事实**：**中国用户对"AI 对话本身"付费意愿 ≈ 0**（因为豆包免费），要收钱必须卖别的（记忆 / 关系 / 仪式感）。这导向了付费墙文案："让 [AI] 永远记得你"，不是"升级会员"。

### 4.3 经济学（玩具单位经济）

年度固定成本（估算）：
- DeepSeek API（10w token/天封顶）≈ ¥180
- 阿里云 ECS ≈ ¥600-1000
- 域名 + 备案 ≈ ¥100
- 短信 SMS（低流量）≈ ¥500
- **合计 ≈ ¥1400-1800**

回本需要的付费用户数：

| 价格 | 需要付费数 | 现实性评估 |
|---|---|---|
| ¥9.9 | 150 人 | ❌ 幻觉级 |
| ¥19.9 | 75 人 | ❌ 仍难 |
| ¥49 | 30 人 | △ 勉强 |
| ¥99 | 15 人 | ✓ 最现实 |

**¥19.9 选的不是"覆盖所有成本"，是"覆盖 API 成本 + 让玩具不成为纯财务负担"**。15 个付费用户 × ¥19.9 = ¥298，刚好盖 DeepSeek API，其他成本由 owner 承担（反正 ECS 也在跑别的东西）。**这是意识清醒的补贴，不是盲目投入。**

---

## 5. 不决策的事（留给 plan doc + gstack review）

以下是我（Claude）在写 plan 时会**默认假设**但希望 gstack review 挑战的品味决策点：

1. **支付聚合通道选型**：虎皮椒 vs 易支付 vs 迅虎支付 — 各 3-5% 费率，接入难度接近；默认选虎皮椒（最老牌），但 eng-review 应该审核其安全性 / 跑路风险 / API 稳定性
2. **付费回调安全**：签名验证的具体协议 + 防重放 + 幂等键；eng-review 要特别看
3. **trial_expires_at 起点**：首次登录 vs 账号创建；默认首次登录（更友好），但是否会被刷手机号滥用？
4. **付费后是否绑死手机号**：如果用户换手机号重新登录算新账号？默认「付费绑手机号 hash，换号要么导入、要么重付」— 是否过严？
5. **UI / copy 决策**：付费墙弹层的文案、动画、时机；design-review 要审
6. **匿名用户能否看到付费墙**：默认**看不到**（匿名完全免费 20 次/天，不诱导付费）；CEO review 可能质疑是否放弃了一部分潜在转化
7. **Kill Switch 里的"关站流程"**：当前 `docs/runbooks/incident-shutdown.md` 不存在；是否同步写？

这些我都会在 plan doc 里**标记为 OPEN QUESTION**，由 `/autoplan` 三轨审阅来挑错 / 确认 / 翻盘。

---

## 6. 授权范围 & 签收

本次对话内 owner 明确授权：

1. ✅ "开始吧" — 执行 P0/P1 + decision doc + plan doc
2. ✅ "我觉得可以" — 接受 ¥19.9 一次性终身 + 7 天无限免费 的付费设计
3. ✅ "运用 superpower 和 gstack 好好优化一下" — 授权走完整 writing-plans + autoplan 流程

尚未授权：
- ❌ 动生产代码（需 plan doc 审阅通过后）
- ❌ 动服务器 .env（需 owner 自己 rotate DeepSeek key 后才有意义）
- ❌ 发出支付聚合通道账号（需 owner 自己注册）

---

## 7. 参考

- office-hours 对话逐字稿：本 session（2026-04-27）
- Project audit：`docs/superpowers/audits/2026-04-27-project-audit.md`
- Paywall plan doc：`docs/superpowers/plans/2026-04-28-paywall-onboarding.md`（下一步产出）
- CLAUDE.md status banner：此 PR 一并更新
- 决策 supersedes：无（首次正式 decision doc）

---

**最后一段不是写给未来 AI agent 的，是写给 3 个月后打开这份文档的 owner 自己的**：

> 你今天做了两件稀缺的事：
>
> 1. 在已经投入 4 周工程的情况下，承认"这是个玩具"，没找借口
> 2. 主动要求写死 Kill Switch，不给未来的自己留拖延空间
>
> 如果 6 个月后这份文档的 Kill Switch 触发了，那 not a failure — 那是你提前替自己做好了退出设计。
>
> 如果 12 个月后触发了"复活条件"，那是 real demand，去 /office-hours 重跑，认真再想一次做什么。
>
> 要么方向都是干净的。这就是玩具的自由。
