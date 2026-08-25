from pathlib import Path
import re


# config-catalog: generated declarations and source metadata are source-owned.
en_path = Path("docs/config-catalog.md")
zh_path = Path("docs/config-catalog.zh.md")
en = en_path.read_text(encoding="utf-8")
zh = zh_path.read_text(encoding="utf-8")
marker = '<a id="'
if marker not in en or marker not in zh:
    raise SystemExit("config catalog anchor marker missing")
zh_prefix = zh[: zh.index(marker)]
generated = en[en.index(marker) :]
generated = re.sub(r"(?m)^Requires:", "需要：", generated)
generated = re.sub(r"(?m)^Types:", "依赖：", generated)
generated = re.sub(r"(?m)^Source:", "来源：", generated)
for source, localized in (
    ("subsystems/core.md", "subsystems/core.zh.md"),
    ("subsystems/tools.md", "subsystems/tools.zh.md"),
    ("subsystems/approval.md", "subsystems/approval.zh.md"),
    ("subsystems/sandbox.md", "subsystems/sandbox.zh.md"),
    ("subsystems/subagent.md", "subsystems/subagent.zh.md"),
    (
        "../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md",
        "../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md",
    ),
):
    generated = generated.replace(source, localized)
zh_path.write_text(zh_prefix + generated, encoding="utf-8")

# module-graph: everything from the Mermaid fence onward is generated, language-neutral data.
# Keep the reviewed Chinese framing, then mirror the generated English graph and package matrix byte-for-byte.
en = Path("docs/module-graph.md").read_text(encoding="utf-8")
zh_path = Path("docs/module-graph.zh.md")
zh = zh_path.read_text(encoding="utf-8")
marker = "```mermaid\n"
if marker not in en or marker not in zh:
    raise SystemExit("module graph mermaid marker missing")
zh_path.write_text(zh[: zh.index(marker)] + en[en.index(marker) :], encoding="utf-8")

# event matrix: data rows are language-neutral; preserve Chinese headings and prose.
en = Path("docs/event-producer-consumer.md").read_text(encoding="utf-8")
zh_path = Path("docs/event-producer-consumer.zh.md")
zh = zh_path.read_text(encoding="utf-8")


def table_bounds(text: str, header: str):
    lines = text.splitlines()
    if header not in lines:
        raise SystemExit(f"event table header missing: {header}")
    start = lines.index(header)
    end = start
    while end < len(lines) and lines[end].startswith("|"):
        end += 1
    return lines, start, end


en_lines, en_start, en_end = table_bounds(
    en, "| Event | Mode | Declared in | Dispatchers | Listeners |"
)
zh_lines, zh_start, zh_end = table_bounds(
    zh, "| 事件 | 模式 | 声明位置 | 派发方 | 监听方 |"
)
merged = zh_lines[: zh_start + 2] + en_lines[en_start + 2 : en_end] + zh_lines[zh_end:]
zh_path.write_text("\n".join(merged) + "\n", encoding="utf-8")
