# Archived Documents

> 这个目录里的文档**已经被取代**，仅供历史溯源。  
> 日常运维 / 部署 / 排错请看父目录或仓库根：

| 旧文档 | 已被替代为 | 取代日期 |
|---|---|---|
| `DEPLOY.md` | `docs/DEPLOYMENT.md` | 2026-04-27 |
| `DEPLOY_RUNBOOK.md` | `docs/DEPLOYMENT.md` §1（First-time setup）+ §3（Routine deploy） | 2026-04-27 |
| `DEPLOY_CHECKLIST.md` | `docs/DEPLOYMENT.md` §A（Security pre-flight） + §6（Backup） | 2026-04-27 |
| `OBSERVABILITY.md` | `docs/DEPLOYMENT.md` §B（Observability reference） | 2026-04-27 |
| `launch-readiness-plan.md` | 上线前一次性 plan，已经全部 ship。后续看 `docs/superpowers/audits/` | 2026-04-27 |

## 为什么不直接 `git rm`

- 保留 git 历史 + 上下文（原作者意图、为什么写、写在什么时间点）
- 当时引用过这些文件名的外部链接 / commit message 仍然指得到内容

## 这些文件不会再被更新

如果发现这里跟 `docs/DEPLOYMENT.md` 有冲突 —— **以 docs/DEPLOYMENT.md 为准**。

任何来这里改东西的人请：
1. 先到 `docs/DEPLOYMENT.md` 改正确版本
2. 如果归档版本里有内容应该回流到主文档 —— 回流，**不要在这里继续维护**

## 归档历史

| 日期 | 操作 | 谁 |
|---|---|---|
| 2026-04-27 | 首次归档 5 份过期 .md（R-09 / R-10） | Claude |
