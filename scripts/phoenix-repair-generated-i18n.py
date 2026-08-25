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
zh_path.write_text(zh_prefix + generated, encoding="utf-8")

# module-graph: graph bytes are language-neutral; preserve reviewed Chinese framing.
en = Path("docs/module-graph.md").read_text(encoding="utf-8")
zh_path = Path("docs/module-graph.zh.md")
zh = zh_path.read_text(encoding="utf-8")
en_block = re.search(r"```mermaid\n.*?\n```", en, flags=re.S)
zh_block = re.search(r"```mermaid\n.*?\n```", zh, flags=re.S)
if en_block is None or zh_block is None:
    raise SystemExit("module graph mermaid block missing")
zh_path.write_text(zh[: zh_block.start()] + en_block.group(0) + zh[zh_block.end() :], encoding="utf-8")

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
