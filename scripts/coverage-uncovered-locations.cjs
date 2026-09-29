'use strict';

/**
 * Istanbul coverage regression reporter.
 *
 * Historical uncovered counts live in coverage-baseline.json and are ceilings,
 * never targets: a file may improve below its baseline, but any increase in
 * uncovered statements, functions, branches, or lines fails the gate. A file
 * absent from the baseline has a zero-debt ceiling, preserving the original
 * 100% expectation for clean/new source without pretending old debt is new.
 *
 * CommonJS by requirement: istanbul-reports loads custom reporters with a bare
 * require() outside the tsx/ESM pipeline.
 */

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { ReportBase } = require('istanbul-lib-report');

const METRICS = ['statements', 'functions', 'branches', 'lines'];
const ZERO = Object.freeze({ statements: 0, functions: 0, branches: 0, lines: 0 });
const baselinePath = path.join(__dirname, 'coverage-baseline.json');
const baselinePayload = JSON.parse(readFileSync(baselinePath, 'utf8'));

if (baselinePayload.version !== 1 || baselinePayload.files === null || typeof baselinePayload.files !== 'object') {
  throw new Error('coverage-regression: invalid scripts/coverage-baseline.json');
}

const baseline = baselinePayload.files;

/**
 * Editor-convention line:column for an Istanbul location start.
 */
function pos(loc) {
  return `${loc.start.line}:${loc.start.column + 1}`;
}

/** Whether a location carries a usable 1-based start line. */
function usable(loc) {
  return Boolean(loc && loc.start && Number.isFinite(loc.start.line) && loc.start.line >= 1);
}

/**
 * End suffix when a range adds useful information beyond its start.
 */
function endSuffix(loc) {
  const end = loc.end;
  if (!end || !Number.isFinite(end.line) || end.line < 1) return '';
  if (!Number.isFinite(end.column)) {
    return end.line === loc.start.line ? '' : ` (to ${end.line})`;
  }
  if (end.line === loc.start.line && end.column === loc.start.column) return '';
  return ` (to ${end.line}:${end.column + 1})`;
}

function uncoveredCounts(fc) {
  const statements = Object.values(fc.s).filter(count => count === 0).length;
  const functions = Object.values(fc.f).filter(count => count === 0).length;
  const branches = Object.values(fc.b).reduce(
    (sum, counts) => sum + counts.filter(count => count === 0).length,
    0,
  );
  const lines = Object.values(fc.getLineCoverage()).filter(count => count === 0).length;
  return { statements, functions, branches, lines };
}

function uncoveredLocations(fc, rel) {
  const items = [];
  const add = (loc, text) => {
    if (usable(loc)) items.push({ line: loc.start.line, column: loc.start.column, text });
  };

  for (const id of Object.keys(fc.statementMap)) {
    if (fc.s[id] !== 0) continue;
    const loc = fc.statementMap[id];
    add(loc, `${rel}:${pos(loc)} uncovered statement${endSuffix(loc)}`);
  }

  for (const id of Object.keys(fc.fnMap)) {
    if (fc.f[id] !== 0) continue;
    const fn = fc.fnMap[id];
    const loc = usable(fn.decl) ? fn.decl : fn.loc;
    const name = fn.name ? ` ${fn.name}` : '';
    add(loc, `${rel}:${pos(loc)} uncovered function${name}`);
  }

  for (const id of Object.keys(fc.branchMap)) {
    const counts = fc.b[id];
    const branch = fc.branchMap[id];
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i] !== 0) continue;
      const loc = usable(branch.locations && branch.locations[i]) ? branch.locations[i] : branch.loc;
      add(loc, `${rel}:${pos(loc)} uncovered branch (${branch.type}, path ${i + 1}/${counts.length})`);
    }
  }

  items.sort((a, b) => a.line - b.line || a.column - b.column);
  return items.map(item => item.text);
}

class CoverageRegressionReport extends ReportBase {
  constructor(opts = {}) {
    super(opts);
    this.projectRoot = opts.projectRoot || process.cwd();
    this.regressions = [];
    this.improved = 0;
    this.seen = 0;
  }

  onStart() {
    this.regressions = [];
    this.improved = 0;
    this.seen = 0;
  }

  onDetail(node) {
    const fc = node.getFileCoverage();
    const rel = path.relative(this.projectRoot, fc.path).split(path.sep).join('/');
    const actual = uncoveredCounts(fc);
    const allowed = baseline[rel] || ZERO;
    this.seen += 1;

    let improved = false;
    const exceeded = [];
    for (const metric of METRICS) {
      if (actual[metric] > allowed[metric]) {
        exceeded.push({ metric, actual: actual[metric], allowed: allowed[metric] });
      } else if (actual[metric] < allowed[metric]) {
        improved = true;
      }
    }
    if (improved) this.improved += 1;
    if (exceeded.length === 0) return;

    this.regressions.push({
      file: rel,
      exceeded,
      locations: uncoveredLocations(fc, rel),
    });
  }

  onEnd() {
    if (this.regressions.length === 0) {
      console.log(
        `coverage-regression: PASS ${this.seen} source file(s); ${this.improved} historical debt file(s) improved.`,
      );
      return;
    }

    console.error(`\ncoverage-regression: FAIL ${this.regressions.length} file(s) exceed their historical uncovered ceilings.`);
    for (const row of this.regressions) {
      console.error(`\n${row.file}`);
      for (const delta of row.exceeded) {
        console.error(`  ${delta.metric}: ${delta.actual} uncovered > baseline ${delta.allowed}`);
      }
      for (const location of row.locations) console.error(`  ${location}`);
    }
    process.exitCode = 1;
    throw new Error('coverage-regression: uncovered coverage debt increased');
  }
}

module.exports = CoverageRegressionReport;
