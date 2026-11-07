# Agent Note: 面向节日的透明 PHOENIX 标志装饰

Status: implemented

[English](2026-11-07-celebration-aware-transparent-phoenix-marks.md) | 中文

## Problem

PHOENIX 首页采用经过认可的银色凤凰图像。重新绘制节日凤凰会损害原始品牌的一致性；将所有节日装入同一种圆形徽章也无法体现不同场合的意义。全球日期还需要处理国家、地区和隐私。

## Decision

保留原始 `apps/web/public/phoenix-emblem.png`，不对其像素作任何修改。日历模块 `packages/client/ui-conversation/src/client/skeleton/celebrations.ts` 处理固定和浮动节日、国际纪念日，并在获得同意时启用职业节日或生日。

`apps/web/public/assets/celebrations/` 包含 143 个独立命名且透明的 SVG 装饰。它们位于原始 PNG 之上，不是重绘的凤凰。`scripts/generate-phoenix-celebration-icons.mjs` 通过日历重新生成这些文件。Nager.Holidays v4 提供无需密钥的公开节日数据，上传的仅为国家和年份，不涉及个人档案。

首页按照本地午夜自动更新；庄重纪念不用不合适的祝贺语，母亲节和父亲节也不预设用户身份。

## Alternatives considered

**为每个节日重新生成完整凤凰。** 拒绝，因为会改变官方原始标识并扩大资源体积。

**所有日期套用同一个圆框和表情符号。** 拒绝，因为缺乏设计差异，也不适合严肃纪念日。

**每次打开界面都调用图像生成器。** 拒绝，因为增加成本、延迟、不确定性和离线问题。

**将个人资料发送给公共节日服务。** 拒绝，因为国家和年份已经足够。

## Consequences

原始凤凰完整保留；各日期拥有独立的透明 SVG 装饰，下载成本小，无需模型生成。离线目录能即时显示，公共 API 仅负责补充国际节日。地区级祝贺需要明确地区设置。自动化测试检查日期、祝贺语、图案覆盖和品牌资产边界；浏览器和发行流程另行验证。
