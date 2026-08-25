from pathlib import Path

path = Path("scripts/gen-doc-graphs.ts")
text = path.read_text(encoding="utf-8")
marker = "  {\n    key: 'planMode',\n"
addition = """  {
    key: 'phoenix',
    pkg: 'phoenix-runtime',
    title: 'PHOENIX adaptive intelligence runtime',
    mode: 'core',
    consumers: ['phoenix'],
    note: 'Evidence-ranked model authority, bounded failover, quarantine, Token Flight Recorder, Agent ROI, and Mother Guard layered around native DSH agent/tool seams.',
  },
  {
    key: 'phoenixAiBus',
    pkg: 'phoenix-ai-bus',
    title: 'PHOENIX compute-cost lane classifier',
    mode: 'core',
    consumers: ['phoenix'],
    note: 'Classifies registered provider/model routes by local-free, remote-free, or metered/unknown cost without granting routing authority.',
  },
  {
    key: 'phoenixContinuity',
    pkg: 'phoenix-continuity',
    title: 'PHOENIX durable continuity state',
    mode: 'core',
    consumers: ['phoenix'],
    note: 'Owns durable Memory Genome and Mission Graph state while execution remains delegated to native DSH workflows, jobs, and subagents.',
  },
  {
    key: 'phoenixRepoBrain',
    pkg: 'phoenix-repo-brain',
    title: 'PHOENIX deterministic repository intelligence',
    mode: 'core',
    consumers: ['phoenix'],
    note: 'Maintains a bounded local lexical/structural repository index and reverse-import impact graph with no model calls for indexing or search.',
  },
"""
if addition in text:
    raise SystemExit("PHOENIX service roles already present")
if text.count(marker) != 1:
    raise SystemExit(f"service-role insertion marker count != 1: {text.count(marker)}")
path.write_text(text.replace(marker, addition + marker, 1), encoding="utf-8")
