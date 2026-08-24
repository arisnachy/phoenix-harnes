'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

function installPath() {
  const configured = vscode.workspace.getConfiguration('phoenix').get('installPath', '').trim()
  if (configured.length > 0) return path.resolve(configured)
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Programs', 'PHOENIX')
  }
  return path.join(os.homedir(), 'phoenix-harnes')
}

function launcher(root) {
  return process.platform === 'win32'
    ? path.join(root, 'phoenix-windows.cmd')
    : path.join(root, 'apps', 'cli', 'lib', 'bin.js')
}

function webUri() {
  const port = vscode.workspace.getConfiguration('phoenix').get('port', 3080)
  return vscode.Uri.parse(`http://127.0.0.1:${port}`)
}

class PhoenixTreeProvider {
  getTreeItem(item) { return item }
  getChildren() {
    const root = installPath()
    const installed = fs.existsSync(launcher(root))
    return [
      {
        label: installed ? 'PHOENIX installed' : 'PHOENIX needs installation',
        description: root,
        iconPath: new vscode.ThemeIcon(installed ? 'flame' : 'warning'),
        contextValue: 'phoenixStatus',
      },
      {
        label: installed ? 'Update PHOENIX' : 'Install PHOENIX',
        command: { command: 'phoenix.install', title: installed ? 'Update PHOENIX' : 'Install PHOENIX' },
        iconPath: new vscode.ThemeIcon('cloud-download'),
      },
      {
        label: 'Start PHOENIX',
        command: { command: 'phoenix.start', title: 'Start PHOENIX' },
        iconPath: new vscode.ThemeIcon('debug-start'),
      },
      {
        label: 'Open PHOENIX interface',
        command: { command: 'phoenix.open', title: 'Open PHOENIX interface' },
        iconPath: new vscode.ThemeIcon('link-external'),
      },
    ]
  }
}

async function startPhoenix() {
  const root = installPath()
  const entry = launcher(root)
  if (!fs.existsSync(entry)) {
    const choice = await vscode.window.showErrorMessage(
      `PHOENIX was not found at ${root}. Run the one-line Windows installer or set phoenix.installPath.`,
      'Open installation guide',
    )
    if (choice === 'Open installation guide') {
      await vscode.env.openExternal(vscode.Uri.parse('https://github.com/arisnachy/phoenix-harnes#one-line-windows-install'))
    }
    return
  }
  const terminal = vscode.window.createTerminal({ name: 'PHOENIX HARDNESS', cwd: root })
  if (process.platform === 'win32') {
    terminal.sendText(`& ${quotePowerShell(entry)}`)
  } else {
    terminal.sendText(`node ${quotePosix(entry)} web`)
  }
  terminal.show(true)
}

async function installPhoenix() {
  if (process.platform !== 'win32') {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/arisnachy/phoenix-harnes#run-from-source'))
    return
  }
  const terminal = vscode.window.createTerminal({ name: 'PHOENIX Installer' })
  terminal.sendText("irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex")
  terminal.show(true)
}

function quotePowerShell(value) { return `'${value.replaceAll("'", "''")}'` }
function quotePosix(value) { return `'${value.replaceAll("'", "'\\''")}'` }

function activate(context) {
  const provider = new PhoenixTreeProvider()
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('phoenix.control', provider),
    vscode.commands.registerCommand('phoenix.start', startPhoenix),
    vscode.commands.registerCommand('phoenix.open', async () => vscode.env.openExternal(webUri())),
    vscode.commands.registerCommand('phoenix.install', installPhoenix),
  )
}

function deactivate() {}

module.exports = { activate, deactivate, PhoenixTreeProvider, installPath, launcher }
