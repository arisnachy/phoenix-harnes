# Agent Note: 保留 Codex 实时模型目录与更新程序的可用性

Status: implemented

[English](2026-10-26-codex-live-model-catalog-and-updater.md) | 中文

## Problem

Eclipse 模型选择器只保留已认证 Codex 目录中最新的 GPT 代际及系列修订版。即使 Codex 仍然公布旧型号和新型号，它们也会从列表中消失。另外，Windows 安装包中的 Phoenix Host 若不在 Git 工作目录下运行，即使配置了安装根目录，也可能跳过 Codex CLI 更新监视程序。

## Decision

已认证的 Codex app-server 仍然是模型可用性和推理能力的权威来源。Eclipse 按 Codex 返回的顺序保留账号可见的全部模型标识，仅去掉重复标识和 Phoenix 的虚拟自动路由，不再根据型号名称推断退役。Eclipse 设置通过 `llm.discoverModels` 直接查询已认证的 Codex app-server，而不使用可能包含固定配置或旧缓存的适配器列表 `llm.models`。发现接口保留服务端公布的推理等级；查询失败时显示错误，不以旧列表假冒实时目录。保存设置前仍须验证所选型号实际公布的推理能力。

即使 Git 根目录探测失败，只要设置了 PHOENIX_INSTALL_ROOT，Codex 更新程序仍可启动。它每 30 分钟查询官方 npm 稳定版本，分阶段安装、冒烟测试并激活经过验证的升级。notify 模式允许显式 --apply；无人值守的监视程序仅在 auto 模式下自动安装。

此决定取代了 [Eclipse 协调器与子代理路由](2026-10-21-eclipse-two-role-routing.zh.md) 中的最新代际过滤，但不改变协调器或子代理的路由策略。

## Alternatives considered

硬编码型号或仅保留最新型号，无法反映具体账号的可用性。只升级 npm 包也不能显示服务端新加入的型号。额外调用语言模型判断目录会增加 token 消耗且缺乏权威性。完全忽略 Git 错误又会绕过源代码更新的安全检查，因此只有显式安装根目录可以用于更新监视程序的启动。

## Consequences

只要 Codex 公布对应型号，Eclipse 就能展示旧型号和未来型号，无需 Phoenix 发版。实际账号及功能可用性仍取决于已认证 CLI 的 model/list 结果，ChatGPT 网页选择器并不保证完全一致。更新程序周期性查询少量 npm 元数据，不调用语言模型。回归测试覆盖多代际选择、界面刷新、监视程序启动及手动更新。实际 Windows 安装及 GitHub CI 是独立的部署验收环节。
