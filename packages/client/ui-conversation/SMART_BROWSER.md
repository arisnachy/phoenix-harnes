# PHOENIX Smart Browser · Adaptive Workspace

## Root causes confirmed on main and stable

The following base files had identical blob SHAs across main and stable when checked on 2026-11-21:
- MiniBrowser.tsx
- ToolActivityFlow.tsx
- ChatView.tsx
- mini-browser.ts

1. Every browser request added a long-lived render card to transcript history. A new model turn could reselect it; the React component's dismissed state was not an authoritative Host release.
2. The browser and optional agent transcript shared the virtual chat scroll flow. Loading frames, tabs, and dynamic sidebar heights changed history geometry and could interact with ChatView bottom-follow behavior. This is a code-level cause; the exact Windows white-space symptom still needs a desktop screenshot regression.
3. The browser displayed navigation, tabs, typing, screenshots, video and login controls simultaneously.

## New lifecycle

- The **active browser task** owns one temporary browser dock outside the chat scroll via a React DOM portal. A compact history receipt remains, not a 72vh browser node.
- Only the *most recent relevant user turn* can open it automatically. A later unrelated turn cannot restore an old browser.
- When the browser task has completed, **release-session** stops that conversation's Chromium child, closes CDP sockets and releases scoped tabs. It never kills unrelated sessions or the user's external Chrome.
- Explicit **Fijar** and genuine user interactions (mouse, keyboard, scroll, advanced controls) preserve the browser; a pending observed login also preserves it.
- **Cerrar** releases the session and restores the chat immediately. **Soltar** after task completion also releases. Reopening an old receipt creates a new, user-pinned browser session.
- Only the current conversation may request release; the Host validates session ID and applies the existing same-origin marker and authorization checks.

## Visual policy

Pearl Light: a single compact heading with page title, real state, overflow actions, pin, expand and close. Tabs, address, type tools, media controls and secure login aids are hidden until requested. The Chrome viewport remains genuine, not simulated.

The dock uses viewport-relative top/right/bottom boundaries, internal overflow, and responsive stacked layout on narrow windows. Neither a screenshot nor an activity panel can extend the chat's scroll height. The chat composer remains owned by PHOENIX.

## Acceptance checklist

- Opening Chrome during model streaming does not increase chat transcript height.
- The input stays reachable at desktop width and responsive widths.
- Switching to an unrelated task does not resurrect a previous Chrome instance.
- Completing a browser task releases its owner-scoped Chromium unless the person pinned/used it.
- A pending human login is never silently dismissed on turn completion.
- Dismissing Chrome returns full chat width and does not affect another conversation.
- Navigation, login, share media, and keyboard actions remain accessible through the overflow menu.
- Regression CI: mini-browser.client, mini-browser-flow.client, mini-browser.spec, mini-browser-scopes.spec, chat-view.client, Windows Desktop Browser, plus desktop screen-height/scroll validation.

## Release policy

Do not declare fixed in the user's installed Windows runtime until the PR passes CI, merges into main and stable, auto-update propagates, and the real desktop regression is checked. No PowerShell configuration is needed for the browser dock.
