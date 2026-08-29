# Agent Note：生成的子系统报告不进入双语索引

状态：已实现

[English](2026-08-29-generated-subsystem-reports.md) | 中文

## 问题

技能验证命令会在 `docs/subsystems/` 下生成 Markdown 报告，但这些报告没有经过审阅的中文对侧，并且会根据 runtime 观察结果重新生成。因此，子系统目录索引与双语配对门禁对这些输出是否属于当前文档的判断不一致。

## 决策

在拥有经过审阅的对侧之前，生成的 `skill-english-overlays.md`、`skill-operational-adapters-by-category.md` 和 `skill-operational-adapters-report.md` 明确列为翻译配对排除项。文档站投影使用相同的排除项，因此生成报告不会出现在子系统 README 或发布侧栏中。OpenClaw skills 与操作适配器的作者维护子系统参考文档已有经过审阅的中文对侧，会在两侧索引，并通过普通配对页面清单发布。

## 已考虑的替代方案

**立即翻译每份生成报告。** 否决：所属命令会根据 runtime 观察结果重新生成这些文件，因此如果每次运行都没有经过审阅的翻译流程，已提交的译文会变得陈旧。

**仅以英文将生成报告加入索引并发布。** 否决：子系统索引将参考页面呈现为维护中的文档，而这些输出是没有稳定审阅对侧的证据快照。

## 验证

`verify-translation-pairing` 会拒绝被排除报告的 `.zh.md` 或 `.i18n.yaml` 对侧，而指定的 OpenClaw 和操作适配器配对必须具有完整 hash 且结构一致。`project-doc-site.spec.ts` 从同一个排除清单推导子系统索引集合，并检查两个 README 语言版本。所属 skill 验证器继续负责报告生成和证据新鲜度。

## 后果

仓库保留生成的证据供维护者使用，同时不会把未翻译的 runtime 报告呈现为双语参考页面。添加经过审阅的对侧时，必须从排除清单移除该准确报告、在两个语言版本的索引中添加行，并在 `website/docs.ts` 注册配对页面。
