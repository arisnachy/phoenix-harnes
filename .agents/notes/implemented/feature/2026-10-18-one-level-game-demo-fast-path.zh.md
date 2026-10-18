# Agent Note：单关可玩游戏优先于重型制作工具链

Status: implemented

[English](2026-10-18-one-level-game-demo-fast-path.md) | 中文

## Problem

一个类似 Double Dragon 的单关演示可能长时间查找已知清单、安装原生引擎、委派研究并打开无关的浏览器，却没有生成可玩的作品。旧路由将所有清版动作游戏都视为需要 Godot 的复杂制作。

## Decision

当目标是在 Phoenix 聊天中交付，且请求明确是演示、原型、可玩切片或单关时，确定性游戏路由选择独立 HTML5。完整制作和原生桌面开发继续使用 Godot。Game Studio 技能要求优先用现有的清版动作游戏清单和运行库生成并发布游戏；浏览器截图或独立专家审核不能阻塞本地可玩交付。MiniBrowser 自动选页会跳过 Phoenix 自身的本地界面，但保留显式选择的标签页。

## Alternatives considered

**所有清版动作游戏都先使用 Godot。** 拒绝：单关 HTML 交付无需复杂工具链。

**等待专家重新研究现有契约。** 拒绝：游戏发布工具、清单和渲染要求已存在于本地。

## Consequences

单关演示无需外部编辑器安装或浏览器依赖。该路由本身不证明游戏已生成、发布工具已连接或画面达到正式产品质量；仍需要真实作品和玩法测试证据。
