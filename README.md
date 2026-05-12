# 一人公司Skill

![version](https://img.shields.io/badge/version-v0.1%20public%20alpha-blue)
![tests](https://img.shields.io/badge/tests-passing-brightgreen)
![license](https://img.shields.io/badge/license-MIT-black)
![focus](https://img.shields.io/badge/focus-China%20solo%20business-red)

面向中国大陆一人公司创业者的商业判断 Skill。  
商业化可行性是第一准则：先判断能不能收费、能不能低成本触达、能不能持续交付，再谈功能、技术和愿景。

> v0.1 public alpha：可以公开试用，但还在快速扩充案例、知识库和真实样例回答。

## 它解决什么

通用大模型很容易给出正确但无用的创业建议：做 MVP、找痛点、持续输出、打造个人品牌。  
一人公司Skill 默认把问题压回商业现实：

- 谁现在会付钱？
- 他现在怎么解决？
- 市面上谁已经收到了钱？
- 一个人能不能交付？
- 国内执行有什么坑？
- 今天做什么能验证支付意愿？

默认面向中国大陆语境下的国内用户。海外案例可以作为商业机制参照，但不能直接照搬；每个结论都要回到国内渠道、支付、合规、信任和交付现实里重新判断。

## 快速开始

把 `skills/one-person-company` 复制到你的 Agent / Codex / ChatGPT-like skills 目录，然后这样提问：

```text
/产品判断
idea: 我想做一个 markdown 转 html 的产品
target_user: 写技术文档、博客、产品说明的人
workflow: 现在需要把 markdown 转成可发布的网页或邮件格式
paid_trigger: 用户为什么现在愿意付钱还不确定
```

```text
/相似案例
idea: 我想做一个面向小红书商家的 AI 选题工具
target_user: 小红书商家、代运营、个人博主
use_case: 每周找选题、写标题、判断爆款角度
market_hint: 不知道
```

```text
/定价获客
idea: 我想做一个一人公司案例检索库
target_user: 独立开发者、自由职业者、小团队创业者
paid_trigger: 做产品前想减少误判
acquisition_channel: GitHub、公众号、即刻、微信群
```

## 真实问题示例

**普通问题：**

```text
我想做一个 AI 小红书选题助手，能不能做？
```

**这个 Skill 应该输出的方向：**

- 先判断它卖的是“选题结果”“节省时间”还是“提高成交概率”。
- 找类似内容工具、代运营服务、模板、社群和小红书商家工作流。
- 判断付费人群是商家、博主、代运营，还是知识付费人群。
- 检查获客路径：小红书内容、微信群、代运营圈子、公众号案例拆解。
- 给第一单验证方式：先卖 19/49/199 元的小样本诊断，而不是先做完整 SaaS。
- 给停损线：20 个目标用户里没有 3 个愿意付费沟通，就不要继续堆功能。

## 工具路径图

```text
产品判断
  -> 相似案例
  -> 商业模式与交付
  -> 定价获客
  -> 停损复盘
```

每一步都要回到一个问题：这个人能不能在国内现实里收到钱，并稳定交付。

## 知识库规模

当前内置：

- 100 条标准化案例
- 30 条 gold cases
- 39 个案例来源
- 10 个 GitHub 高价值开源知识源
- 16 条 GitHub 实操信号
- 13 个回答质量评估场景
- 5 条金标回答样本

案例和 GitHub 来源不是用来装饰回答的。每条资料都要拆成：

- 目标用户
- 付费机制
- 获客路径
- 交付方式
- 可复制部分
- 不可复制风险
- 国内适配条件

## 项目结构

```text
skills/
  one-person-company/
    SKILL.md                         # Skill 入口
    references/
      business-judgment.md           # 产品判断和商业可行性
      business-model-delivery.md     # 收费、支付、交付、毛利、复购、停损
      case-intelligence.md           # 案例检索和对照方法
      china-reality.md               # 国内执行现实

knowledge/
  cases/                             # 一人公司案例情报库
  github-sources/                    # GitHub 实操信号和开源知识源
  evals/answer-quality/              # 回答质量评估集
  market-patterns/                   # 细分市场模式

scripts/opc/                         # 案例校验、导入、检索工具
tests/opc/                           # 仓库边界和知识库质量测试
```

## 本地工具

安装依赖：

```bash
npm install
```

校验仓库：

```bash
npm test
```

匹配相似案例：

```bash
node scripts/opc/match-product-idea.js "我想做一个 AI 小红书选题助手"
```

校验案例库：

```bash
npm run opc:validate:cases:seed
```

校验 GitHub 实操信号：

```bash
npm run opc:validate:github-sources
```

## 质量门槛

好回答应该：

- 简洁，但不是空泛。
- 直接，但不是情绪化。
- 反驳用户时给出商业理由。
- 用案例、竞品、替代方案或渠道事实提供信息增量。
- 说清楚国内现实约束，例如备案、支付、平台分发、微信生态、交付信任和合规摩擦。
- 拆清楚商业模式：服务、模板、工具、咨询、社群、数据、自动化，不能混在一起讲。
- 说明第一单如何支付、交付边界是什么、毛利和售后风险在哪里。
- 明确今天能做的验证动作，以及停损线。

坏回答通常长这样：

- 建议用户先做 MVP，但没有说卖给谁。
- 建议持续输出，但没有渠道、内容角度和成交路径。
- 说市场很大，但没有现有付费机制。
- 只分析功能，不分析获客和交付成本。

## 路线图

- [x] 清理旧站点，转为纯 Skill 仓库
- [x] 建立一人公司核心 Skill
- [x] 建立案例库和相似案例检索
- [x] 建立 GitHub 实操信号库
- [x] 增加商业模式与交付 reference
- [ ] 补 10 个高质量示例回答
- [ ] 扩充国内一人公司案例
- [ ] 增加普通大模型 vs 本 Skill 的回答对比
- [ ] 做第一轮真实用户内测

## License

MIT License. See [LICENSE](LICENSE).
