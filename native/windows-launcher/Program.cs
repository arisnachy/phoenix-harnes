using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using Microsoft.AI.Actions.Annotations;
using Windows.AI.Actions;

namespace Phoenix.WindowsLauncher;

public static class Program
{
    [STAThread]
    public static void Main()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        var app = new Application { ShutdownMode = ShutdownMode.OnLastWindowClose };
        // The generated COM server must stay alive until Windows invokes it.
        app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        ComServerRegisterActions.RegisterActions();
        app.Run();
    }

    internal static void ShowDraft(string agentName, string prompt)
    {
        var window = new Window {
            Title = "PHOENIX · Kira — review request",
            Width = 650, Height = 420, WindowStartupLocation = WindowStartupLocation.CenterScreen
        };
        var panel = new DockPanel { Margin = new Thickness(16) };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 12, 0, 0) };
        DockPanel.SetDock(buttons, Dock.Bottom);
        var copy = new Button { Content = "Copy draft", Padding = new Thickness(12, 6, 12, 6) };
        var open = new Button { Content = "Open local PHOENIX", Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(8, 0, 0, 0) };
        var close = new Button { Content = "Discard", Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(8, 0, 0, 0) };
        var text = new TextBox { Text = prompt, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        copy.Click += (_, _) => { try { Clipboard.SetText(text.Text); } catch { MessageBox.Show("Clipboard unavailable."); } };
        open.Click += (_, _) => { try { Process.Start(new ProcessStartInfo("http://127.0.0.1:3080/") { UseShellExecute = true }); } catch { MessageBox.Show("PHOENIX could not be opened."); } };
        close.Click += (_, _) => window.Close();
        buttons.Children.Add(copy); buttons.Children.Add(open); buttons.Children.Add(close);
        panel.Children.Add(buttons);
        var label = new TextBlock { Text = "Review this external draft. Nothing is sent automatically. Copy only if authorized.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 10) };
        DockPanel.SetDock(label, Dock.Top);
        panel.Children.Add(label); panel.Children.Add(text);
        window.Content = panel;
        window.Closed += (_, _) => { if (Application.Current.Windows.Count <= 1) Application.Current.Shutdown(); };
        window.Show();
        window.Activate();
    }
}

[ActionProvider]
public sealed class KiraProvider
{
    [WindowsAction(Id = "PHOENIX.OpenKira", Description = "Open PHOENIX for interactive review", Icon = "ms-resource://Files/Assets/PhoenixLogo.png", UsesGenerativeAI = false)]
    [WindowsActionInputCombination(Inputs = ["agentName", "prompt"], Description = "Open PHOENIX")]
    public async Task OpenKira([Entity(Name = "agentName")] string agentName,
        [Entity(Name = "prompt")] string prompt, InvocationContext context)
    {
        if (string.IsNullOrWhiteSpace(agentName) || agentName.Length > 128 ||
            string.IsNullOrWhiteSpace(prompt) || prompt.Length > 4096)
            throw new ArgumentException("Invalid agent request");
        await Application.Current.Dispatcher.InvokeAsync(() => Program.ShowDraft(agentName, prompt));
    }
}
