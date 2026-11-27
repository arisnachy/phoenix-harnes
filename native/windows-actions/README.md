# PHOENIX Native Windows execution pilot

Local UIA uses Windows PowerShell 5.1 and the existing authorized shell. Use scripts/phoenix-windows-native.ps1 with Inspect, a specific TargetPid, and subsequently Focus or Invoke with an exact AutomationId and explicit Apply/confirmation. The pilot intentionally restricts applications and does not read document text, passwords or arbitrary desktop content. Invoke returns a request receipt, not proof of success; independently inspect the result. AgentList uses the official ODR catalog when installed.

The optional .NET 8 consumer can be built with dotnet build native/windows-actions/Phoenix.WindowsActions.csproj. Run it interactively with list or invoke, enter the text input, and select an action in the current catalog. The SDK and runtime must support the actual Windows build. Third-party app actions may use network or paid services; the operator must verify cost and authorization before selecting one. Never use it to automate consumer Copilot.

agentRegistration.json and registration.template.json are draft registration assets, not an installed agent. A packaged provider must implement the protocol activation, deliver the prompt to a user-reviewed PHOENIX draft, provide the icon and manifest extensions, and pass installation, catalog readback and invocation checks before activation. No automatic certificate trust changes, package installation or registration are performed.

Run scripts/phoenix-windows-native-smoke.ps1 on an interactive Windows desktop for synthetic UIA readback and a negative mutation test. Windows CI compilation and local smoke results are separate from end-to-end App Actions and Agent Launchers verification. No cloud subscription is required by these tools.
