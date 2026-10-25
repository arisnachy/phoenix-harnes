#!/usr/bin/env python3
"""Preserve Chinese prose while syncing exact generated tool JSON schemas.

Fail closed if tool ordering, package/tool headings, or prose changes require
human localization review. Never mark stale translations as reviewed.
"""
from __future__ import annotations

from pathlib import Path
import re
import subprocess

EN = Path("docs/tool-catalog.md")
ZH = Path("docs/tool-catalog.zh.md")
JSON_FENCE = re.compile(r"```json\n.*?\n```", re.DOTALL)
TOOL_HEADING = re.compile(r"^### `[^`]+`$", re.MULTILINE)
PACKAGE_HEADING = re.compile(r"^## `[^`]+`$", re.MULTILINE)

def previous(path: Path) -> str:
    return subprocess.check_output(["git", "show", f"HEAD:{path.as_posix()}"], text=True)

def assert_structure(previous_en: str, previous_zh: str, current_en: str) -> None:
    for heading in (TOOL_HEADING, PACKAGE_HEADING):
        old = heading.findall(previous_en)
        if old != heading.findall(previous_zh) or old != heading.findall(current_en):
            raise ValueError("Tool or package headings changed: translation review required")
    orig_blocks = JSON_FENCE.findall(previous_en)
    localized_blocks = JSON_FENCE.findall(previous_zh)
    generated_blocks = JSON_FENCE.findall(current_en)
    if not orig_blocks or orig_blocks != localized_blocks or len(orig_blocks) != len(generated_blocks):
        raise ValueError("JSON tool schema alignment changed: translation review required")
    # Every English change must be inside the verbatim JSON schemas. Package
    # tables, descriptions, links and prose must not silently fall out of sync.
    old_prose = JSON_FENCE.sub("<SCHEMA>", previous_en)
    new_prose = JSON_FENCE.sub("<SCHEMA>", current_en)
    if old_prose != new_prose:
        raise ValueError("Generated English prose/table changed: translate and review manually")

def main() -> None:
    previous_en = previous(EN)
    previous_zh = previous(ZH)
    current_en = EN.read_text()
    if ZH.read_text() != previous_zh:
        raise ValueError("Chinese tool catalog was changed during integration")
    assert_structure(previous_en, previous_zh, current_en)
    current_schemas = iter(JSON_FENCE.findall(current_en))
    candidate = JSON_FENCE.sub(lambda _match: next(current_schemas), previous_zh)
    if JSON_FENCE.findall(candidate) != JSON_FENCE.findall(current_en):
        raise ValueError("Generated schema sync verification failed")
    if candidate != previous_zh:
        ZH.write_text(candidate)
        print("Synchronized reviewed technical JSON schemas in Chinese tool catalog")
    else:
        print("Chinese tool catalog JSON schemas already agree with generated English")

if __name__ == "__main__":
    main()
