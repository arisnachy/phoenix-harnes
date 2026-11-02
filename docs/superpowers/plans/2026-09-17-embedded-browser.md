# PHOENIX Embedded Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PHOENIX Desktop's external Edge `--app` launcher with a native WinForms shell that embeds the existing PHOENIX UI plus a collapsible WebView2 browser pane.

**Architecture:** Keep the existing runtime/tray lifecycle in `PhoenixApplicationContext`, but make it own a single `PhoenixMainForm`. The form hosts two isolated WebView2 controls in a SplitContainer: the PHOENIX GUI and an external browser. A small typed native bridge handles browser commands from the PHOENIX page and emits browser-state events back into it.

**Tech Stack:** .NET 8 WinForms, Microsoft.Web.WebView2 1.0.4191.47, System.Text.Json, GitHub Actions on windows-latest.

**Spec:** `docs/superpowers/specs/2026-09-17-embedded-browser.md`

## Global Constraints

- Preserve the existing managed-runtime startup, tray, autostart, and process ownership behavior.
- Browser and PHOENIX shell must use separate WebView2 user-data directories.
- Only `http`, `https`, and `about:blank` navigation may reach the external browser surface.
- Do not add iframe-based fallback to the web-only application.
- Keep `main` and `stable` independently buildable.

---

### Task 1: Browser contract tests

**Files:**
- Create: `apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj`
- Create: `apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs`
- Create: `apps/desktop-windows/Properties/AssemblyInfo.cs`

**Interfaces:**
- Consumes: `BrowserNavigation.NormalizeAddress(string)` and `BrowserCommand.TryParse(string, out BrowserCommand)` to be introduced in Task 2.
- Produces: an executable contract-test project returning non-zero when browser navigation/bridge behavior regresses.

- [ ] **Step 1: Write the failing contract tests** covering hostname→HTTPS, loopback→HTTP, free-text→search, executable-scheme rejection, valid open/close bridge commands, and malformed JSON rejection.
- [ ] **Step 2: Run `dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj` on Windows CI and confirm RED because the production browser contracts do not exist.**
- [ ] **Step 3: Keep the tests unchanged while implementing Task 2.**

### Task 2: Embedded browser shell

**Files:**
- Modify: `apps/desktop-windows/Phoenix.Desktop.csproj`
- Modify: `apps/desktop-windows/Program.cs`
- Create: `apps/desktop-windows/BrowserContracts.cs`
- Create: `apps/desktop-windows/PhoenixMainForm.cs`

**Interfaces:**
- Consumes: existing `Program.PhoenixUri`, runtime lifecycle, and tray actions.
- Produces: `BrowserNavigation.NormalizeAddress`, `BrowserCommand.TryParse`, and `PhoenixMainForm`.

- [ ] **Step 1: Add Microsoft.Web.WebView2 1.0.4191.47 to the desktop project.**
- [ ] **Step 2: Implement `BrowserNavigation.NormalizeAddress` and `BrowserCommand.TryParse` minimally until Task 1 becomes GREEN.**
- [ ] **Step 3: Implement `PhoenixMainForm` with a SplitContainer, PHOENIX WebView2, collapsible browser WebView2, navigation toolbar, separate user-data profiles, external-link interception, and `window.phoenixBrowser` web-message bridge.**
- [ ] **Step 4: Refactor `PhoenixApplicationContext` to own/show the native form instead of launching Edge.**
- [ ] **Step 5: Build `apps/desktop-windows/Phoenix.Desktop.csproj` and rerun the contract executable.**

### Task 3: Windows verification workflow

**Files:**
- Create: `.github/workflows/desktop-browser-ci.yml`

**Interfaces:**
- Consumes: desktop project and contract-test executable.
- Produces: a repeatable Windows verification gate for work branches, `main`, and `stable`.

- [ ] **Step 1: Add a `windows-latest` workflow that restores/builds PHOENIX Desktop and runs the contract test executable.**
- [ ] **Step 2: Push the test-only state and observe RED.**
- [ ] **Step 3: Push production implementation and observe GREEN.**

### Task 4: Promote to main and stable

**Files:**
- No new source files; promote the verified commit set.

**Interfaces:**
- Consumes: GREEN work-branch commit.
- Produces: independently verified `main` and `stable` branch heads.

- [ ] **Step 1: Fast-forward `main` only if its head still matches the work branch base.**
- [ ] **Step 2: Verify the desktop workflow on `main`.**
- [ ] **Step 3: Rebase/apply the same desktop files onto an isolated branch from `stable`.**
- [ ] **Step 4: Verify the desktop workflow on the stable work branch, then fast-forward `stable`.**
- [ ] **Step 5: Verify branch heads and report exact commit SHAs.**