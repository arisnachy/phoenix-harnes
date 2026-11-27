using Microsoft.AI.Actions.Helpers;
using Windows.AI.Actions;
using System.Text.Json;

// Text-only consumer pilot. No implicit invocation, credentials, or billing.
if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 26100))
{
    Console.Error.WriteLine("Windows build 26100 or later required.");
    return 2;
}
if (args.Length != 1 || (args[0] != "list" && args[0] != "invoke"))
{
    Console.Error.WriteLine("Usage: Phoenix.WindowsActions list|invoke; enter text on stdin.");
    return 2;
}
try
{
    var text = Console.ReadLine();
    if (string.IsNullOrWhiteSpace(text) || text.Length > 4096) return 2;
    using var runtime = ActionRuntimeFactory.CreateActionRuntime();
    var entity = runtime.EntityFactory.CreateTextEntity(text);
    var actions = runtime.ActionCatalog.GetActionsForInputs(new ActionEntity[] { entity }).Take(100).ToArray();
    Console.WriteLine(JsonSerializer.Serialize(actions.Select((a, i) => new {
        index = i, description = a.DisplayInfo.Description,
        packageFamilyName = a.Definition.PackageFamilyName
    })));
    if (args[0] == "list") return 0;
    // Selection and confirmation must occur in the same process/catalog instance.
    if (Console.IsInputRedirected) return 3;
    Console.WriteLine("Select action index:");
    if (!int.TryParse(Console.ReadLine(), out var index) || index < 0 || index >= actions.Length) return 2;
    Console.WriteLine("Only continue for a known local, free action. Do not invoke consumer Copilot or send sensitive information. Type INVOKE to confirm:");
    if (Console.ReadLine() != "INVOKE") return 3;
    await actions[index].InvokeAsync();
    var outputs = actions[index].Context.GetOutputEntities();
    Console.WriteLine(JsonSerializer.Serialize(new { status = "invoked", outputCount = outputs.Length, outcome = "provider-result-not-independently-verified" }));
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine("Windows action unavailable or failed: " + error.GetType().Name);
    return 1;
}
