# Agent Note: 科研输出区分证据、文稿结构和视觉呈现

Status: implemented

[English](2026-10-18-scientific-hybrid-publication.md) | 中文

## Problem

即使 PDF 文件有效，内容也可能只是简短摘要，却被声称为完整论文或研究综述。原有发布器混淆引文规范与视觉样式，缺少具有来源关联的真实数据表格。

## Decision

现有 `phoenix_research_publish` 工具将 `document_type`（简报、综述、原创研究、学位论文、期刊稿件及政策报告）、`style`（APA/APA7 与 Vancouver）和 `presentation`（academic、editorial、hybrid）分开设置。Python 发布器在生成文件前检查研究类型所需的章节；没有独立记录的筛选与提取证据时，不接受系统综述。所有数据表格必须指向正文引用的来源，并输出为可编辑的 Word 表格、可跨页 PDF 表格和 HTML 表格。混合样式采用克制的色彩、标题层次、页眉页脚与图形，同时保留原有引文规则。

发布回执明确说明：输入的参考文献元数据尚未独立验证，也没有完成逐页视觉审查或期刊投稿认证。工具拒绝 `submission_ready: true`，因为正式投稿需要期刊专门审核和作者负责。旧版短报告沿用 `brief` 与 `academic` 默认值。

## Alternatives considered

**所有论文统一套用 JAMA 风格：**精美的出版物版式不等于符合投稿要求的 Word 稿件；JAMA 与 APA 的规则不同。

**强制二十篇文献或固定页数：**数量不能证明科学有效性；应验证研究结构与来源追踪，而不是填充内容。

**用粗略自制格式器宣称全面支持 CSL：**在元数据和格式验证完成前，仅声明当前实际实现的两类引文规范。

## Consequences

研究人员可以选择适合阅读的混合出版样式，而不会覆盖严格学术样式。引用信息和研究结果仍须独立核查；文件渲染器不能替代实际研究、系统综述方法验证、学校 APA 合规审核或同行评议。Linux 与 Windows 的冒烟测试覆盖文件格式。

## Testing

`scripts/phoenix-research-publisher-smoke.py` 以 APA 学术、APA7 编辑及 Vancouver 混合模式生成真实 DOCX/PDF/HTML；验证表格与图形描述，并拒绝章节不全的学位论文和系统综述输入。
