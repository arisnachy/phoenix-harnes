namespace Phoenix.Desktop;

/// <summary>First-use human-only credential dialog; no secret travels through the chat.</summary>
internal sealed class BrowserLoginPrompt : Form
{
    private readonly TextBox account = new() { Width = 370 };
    private readonly TextBox secret = new() { Width = 370, UseSystemPasswordChar = true };
    private readonly CheckBox remember = new() {
        AutoSize = true, Checked = false,
        Text = "Recordar en el vault protegido y autorizar tareas futuras en este sitio"
    };
    internal string Account => account.Text;
    internal string Secret => secret.Text;
    internal bool Remember => remember.Checked;

    internal BrowserLoginPrompt(string origin)
    {
        Text = "Phoenix · Acceso seguro";
        Width = 520;
        Height = 330;
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        var layout = new TableLayoutPanel {
            Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1,
            RowCount = 8, AutoScroll = true
        };
        Controls.Add(layout);
        layout.Controls.Add(new Label {
            Text = "Conectar a " + origin, AutoSize = true,
            Font = new Font(Font, FontStyle.Bold)
        });
        layout.Controls.Add(new Label {
            Text = "Introduce las credenciales aquí. Kira no verá tu contraseña.",
            AutoSize = true
        });
        layout.Controls.Add(new Label { Text = "Usuario o correo", AutoSize = true });
        layout.Controls.Add(account);
        layout.Controls.Add(new Label { Text = "Contraseña", AutoSize = true });
        layout.Controls.Add(secret);
        layout.Controls.Add(remember);
        var actions = new FlowLayoutPanel {
            FlowDirection = FlowDirection.RightToLeft,
            Dock = DockStyle.Fill, AutoSize = true
        };
        var confirm = new Button { Text = "Conectar", Width = 100, DialogResult = DialogResult.OK };
        confirm.Click += (_, _) => {
            if (string.IsNullOrWhiteSpace(account.Text) || string.IsNullOrEmpty(secret.Text))
            {
                DialogResult = DialogResult.None;
                MessageBox.Show(this, "Introduce usuario y contraseña.",
                    "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        };
        var cancel = new Button { Text = "Cancelar", Width = 90, DialogResult = DialogResult.Cancel };
        actions.Controls.Add(confirm);
        actions.Controls.Add(cancel);
        layout.Controls.Add(actions);
        AcceptButton = confirm;
        CancelButton = cancel;
    }
}
