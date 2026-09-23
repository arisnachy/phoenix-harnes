# Agent Note: Resident Windows Computer driver

Status: implemented

English | [中文](2026-09-23-resident-windows-computer-driver.zh.md)

## Problem

Phoenix Desktop previously paid for a new PowerShell process and C# compilation on every general Computer action. The browser control channel also handled one request per pipe connection, which added connection setup to every embedded-browser command and made reply correlation implicit.

## Decision

Phoenix Desktop exposes a schema-2 Computer channel over one current-user named pipe. `DesktopBrowserControlServer` keeps a connection alive, accepts one request at a time, authenticates the named-pipe client as the owned runtime process or one of its descendants, and returns the request identifier in every reply. `DesktopComputerDriver` performs Win32 screenshot, window, focus, mouse, keyboard, and scroll operations from the resident desktop process.

The TypeScript client keeps one connection per process, serializes every Computer request through the resident channel while Phoenix Desktop is available, validates reply schema and size, and destroys the connection on timeout, protocol failure, or cancellation. For state-changing actions, the native reply includes a screenshot captured immediately after input injection returns, avoiding a separate screenshot request and fixed post-action delay. Credential actions suppress screenshot capture so the private prompt or just-filled form is not attached to the model turn. The PowerShell driver remains available when Phoenix Desktop has not published its descriptor.

Schema 2 rejects account and secret properties. `browser_login` carries only the current HTTPS origin; the desktop host checks the live WebView origin, asks through the private Phoenix prompt only when the broker has no credential, obtains a one-use origin-bound capability, and fills one unambiguous visible account/password pair without submitting the form. `browser_forget_credentials` deletes the saved value for the current origin. Credentials do not enter Computer arguments, results, screenshots returned for the login action, or learned flow records; the safe learning projection keeps only action names and canonical origins. The user can turn off vault persistence in the prompt. The broker uses an AppContainer profile and DPAPI at rest, but the AppContainer SID is shared by processes launched with that profile; this does not protect against a malicious process able to run under the same Windows user and AppContainer SID.

## Alternatives considered

**Start a native helper for every action.** Rejected because process startup would preserve the latency that the resident driver removes and would complicate ownership and cancellation.

**Keep one pipe connection per action.** Rejected because repeated named-pipe setup adds measurable handshake work and prevents one channel from providing serialized request ownership.

**Put credentials in the Computer request.** Rejected because model arguments and logged tool-call events are durable. A dedicated host prompt and broker keep account/password fields out of that protocol and its learning projection.

## Consequences

Warm Desktop actions avoid PowerShell startup and C# compilation and receive a request-correlated observation on the same response. The server rejects same-user processes outside the owned runtime tree, and a timeout or cancellation closes the connection without retrying a mutation. The fallback path retains the existing PowerShell behavior for source or non-Desktop compositions. The resident channel also serializes screenshots with credential prompts so a Computer screenshot call cannot capture the private prompt while the same runtime is waiting for user input.

The native C# build and interactive Windows smoke remain required evidence before publishing a release. This decision does not claim timing parity with Codex; that requires a same-machine benchmark with identical cold and warm actions.
