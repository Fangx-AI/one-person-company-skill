# 安装验证

这个仓库的 Skill 目录是：

```text
skills/opc
```

## Codex

Codex 的 `skill-installer` 可以从 GitHub 仓库安装指定目录。

验证命令：

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo Fangx-AI/one-person-company-skill \
  --path skills/opc
```

Windows 下脚本路径通常是：

```powershell
python C:\Users\PC\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py --repo Fangx-AI/one-person-company-skill --path skills/opc
```

安装后重启 Codex，让新 Skill 被加载。

已验证：

```text
Installed opc to <temp>/opc
```

说明：本仓库已验证 `Fangx-AI/one-person-company-skill` + `skills/opc` 这个路径可以被 Codex 安装脚本识别。不同机器上如果 `python` 不在 PATH，需要改用本机 Python 绝对路径。

## 手动安装

如果你不想跑安装脚本：

1. 下载或 clone 本仓库。
2. 复制 `skills/opc` 目录。
3. 放到你的 Agent / Codex / skills 目录。
4. 重启对应工具。

只需要复制 `skills/opc`，不需要复制整个仓库。

## Cursor / Trae / 其他 Agent

这些工具不一定有统一的 Skill 目录规范。可用方式是：

1. 把 `skills/opc/SKILL.md` 作为主规则。
2. 把 `skills/opc/references/` 作为补充知识库。
3. 把 `knowledge/market-patterns/` 和 `examples/` 作为案例参考。

## 不写成主路径的命令

`npx skills add ...` 目前未作为主安装路径。

原因：这个命令在当前仓库没有完成端到端验证。安装说明只放可解释、可验证的路径，避免用户复制后失败。
