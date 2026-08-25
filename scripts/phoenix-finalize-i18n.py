from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def add_switcher(path: str, switcher: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if switcher in text:
        return
    lines = text.splitlines(keepends=True)
    if not lines or not lines[0].startswith("# "):
        raise SystemExit(f"{path}: expected H1 on first line")
    lines.insert(1, f"\n{switcher}\n")
    p.write_text("".join(lines), encoding="utf-8")


def insert_table_row(path: str, marker: str, row: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if row in text:
        return
    if text.count(marker) != 1:
        raise SystemExit(f"{path}: table insertion marker count != 1")
    p.write_text(text.replace(marker, marker + row, 1), encoding="utf-8")


def pre_generate() -> None:
    # Every package README pair must expose a visible language switcher.
    pairs = [
        ("packages/bundle/phoenix/README.md", "English | [中文](README.zh.md)"),
        ("packages/bundle/phoenix/README.zh.md", "[English](README.md) | 中文"),
        ("packages/phoenix/ai-bus/README.md", "English | [中文](README.zh.md)"),
        ("packages/phoenix/ai-bus/README.zh.md", "[English](README.md) | 中文"),
        ("packages/phoenix/repo-brain/README.md", "English | [中文](README.zh.md)"),
        ("packages/phoenix/repo-brain/README.zh.md", "[English](README.md) | 中文"),
        ("packages/phoenix/runtime/README.md", "English | [中文](README.zh.md)"),
        ("packages/phoenix/runtime/README.zh.md", "[English](README.md) | 中文"),
    ]
    for path, switcher in pairs:
        add_switcher(path, switcher)

    # AI Bus Chinese structure mirrors the four-step authority/cost rule.
    replace_once(
        "packages/phoenix/ai-bus/README.zh.md",
        "## 设计规则\n\n成本、能力和权限是彼此独立的维度。DSH 注册表证明路由存在；AI Bus 判断成本通道；PHOENIX 能力阶梯判断角色权限；路由器随后才可优先选择更便宜且已获授权的候选模型。",
        "## 设计规则\n\n成本、能力和权限是彼此独立的维度：\n\n1. DSH adapter registry 证明路由存在；\n2. AI Bus 判断该路由属于哪个成本通道；\n3. PHOENIX Capability Ladder 判断该模型是否拥有对应角色权限；\n4. 只有随后，路由才可以优先选择成本最低且已获授权的候选模型。",
    )

    # Repo Brain Chinese structure mirrors the model-facing action list and stable guidance block.
    replace_once(
        "packages/phoenix/repo-brain/README.zh.md",
        "## 面向模型的工具\n\nPHOENIX bundle 注册 `repo_brain`，包含四个动作：`search`、`impact`、`refresh` 和 `stats`。Repo Brain 是只读能力，没有源码写入操作。它限制仓库相对路径，但它不是操作系统 sandbox；强隔离仍由 DSH sandbox 能力负责。",
        "## 面向模型的工具\n\nPHOENIX bundle 注册 `repo_brain`，包含四个动作：\n\n- `search` — 对与查询相关的文件和符号进行排序；\n- `impact` — 从一个已索引文件沿反向相对导入依赖遍历；\n- `refresh` — 刷新增量索引；\n- `stats` — 返回已索引文件、符号和边统计。\n\nRepo Brain 是只读能力，没有源码写入操作。它限制仓库相对路径，但它不是操作系统 sandbox；强隔离仍由 DSH sandbox 能力负责。",
    )
    replace_once(
        "packages/phoenix/repo-brain/README.zh.md",
        "插件挂载后，系统提示会包含稳定的 Repo Brain 使用提示，要求在大范围 grep/read 之前优先使用 `repo_brain` 定位架构、符号和反向依赖影响。",
        "插件挂载后，系统提示会包含以下稳定指导：\n\n##### Repo Brain guidance\n\n```markdown\nUse repo_brain before broad repository grep/read sweeps when locating architecture, symbols, or reverse dependency impact. It is a deterministic local index and uses no model calls.\n```",
    )
    replace_once(
        "packages/phoenix/repo-brain/README.zh.md",
        "- **完整结果字节上限** — 当前项目数有限制，但完整渲染结果的独立字节上限必须在生产完成前加入。",
        "- **完整结果字节上限** — 面向模型的完整工具文本现在限制为 16 KiB，并使用 UTF-8 安全截断；极大的结果集合可能以 `[truncated]` 结尾。",
    )

    # The new subsystem page must be discoverable from both locale indexes.
    insert_table_row(
        "docs/subsystems/README.md",
        "| [core.md](core.md) | how `packages/core` controls the agent loop: the package-by-package loop description, agent creation and ownership (`AgentHandle`), the `Agent` handle's delivery/cancellation/interception contracts, and the repo-wide type patterns (`…Map → derived-union`, branded ids) |\n",
        "| [phoenix.md](phoenix.md) | PHOENIX adaptive intelligence, cost-lane classification, Repo Brain, Memory Genome, and Mission Graph services layered on native DSH seams |\n",
    )
    insert_table_row(
        "docs/subsystems/README.zh.md",
        "| [core.md](core.zh.md) | `packages/core` 如何控制 agent loop（智能体循环）：逐包的循环说明、agent 创建与所有权（`AgentHandle`）、`Agent` 句柄的投递/取消/拦截约定，以及全仓通用类型模式（`…Map → 派生联合`、品牌化 id） |\n",
        "| [phoenix.md](phoenix.zh.md) | PHOENIX 自适应智能、成本通道分类、Repo Brain、Memory Genome 与 Mission Graph 服务，并保持在原生 DSH 接缝之上 |\n",
    )


def post_generate() -> None:
    # These technical pages are fully generated in English only. Keep the Chinese
    # route structurally current rather than serving a stale graph/catalog. Their
    # prose can be translated independently later without changing generated facts.
    for stem in ("capability-seams", "config-catalog", "module-graph"):
        source = Path(f"docs/{stem}.md")
        target = Path(f"docs/{stem}.zh.md")
        shutil.copyfile(source, target)


parser = argparse.ArgumentParser()
parser.add_argument("phase", choices=("pre", "post"))
args = parser.parse_args()
if args.phase == "pre":
    pre_generate()
else:
    post_generate()
