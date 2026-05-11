# 一人公司作战库 - 情报库

这个目录保存的是一人公司案例情报，不是文章摘录仓库。

## 分层

- `source-map.jsonl`: 数据源目录，每一条代表一个可持续抓取或人工补充的来源
- `raw/raw-cases.jsonl`: 原始线索，只保存标题、URL、短信号、时间、语言、来源引用
- `normalized/normalized-cases.jsonl`: 标准化案例，把原始线索整理成可比对的商业结构
- `gold/gold-cases.jsonl`: 高价值样本，保留可复用的商业路径和风险提示
- `schema/*.json`: 每层数据的字段约束

## 规则

- 只保存公开可访问来源的元数据、短摘要、结构化事实和我们的判断
- 不存长篇转载，不存大段正文，不把原文复制进库
- 每条 normalized case 必须能回溯到 raw case
- 每条 gold case 必须能回溯到 normalized case
- 评价一个案例时，优先写清楚：产品形态、获客路径、交付方式、定价方式、商业断点、国内可迁移风险

## 目标

v0.1 目标是把案例情报库变成 skill 的底座：

- 1000 条 raw source / raw case
- 300 条 normalized case
- 50 条 gold case

