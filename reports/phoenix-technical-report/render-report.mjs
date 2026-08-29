import { access, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const htmlPath = resolve(root, 'report.html');
const pdfPath = resolve(root, 'phoenix-technical-report.pdf');

function renderWithPlaywrightCli() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pnpm.cmd', [
      'exec', 'playwright', 'pdf',
      '--paper-format', 'A4',
      '--browser', 'chromium',
      '--color-scheme', 'light',
      '--wait-for-timeout', '500',
      pathToFileURL(htmlPath).href,
      pdfPath,
    ], { stdio: 'inherit', shell: true, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`Playwright terminó con código ${code ?? 'desconocido'}.`)));
  });
}

async function main() {
  await access(htmlPath);
  await mkdir(root, { recursive: true });
  await renderWithPlaywrightCli();
  const info = await stat(pdfPath);
  if (info.size === 0) throw new Error('El PDF se creó vacío.');
  console.log(`REPORT_RENDER_PASS ${pdfPath} ${info.size} bytes`);
}

main().catch((error) => {
  console.error(`REPORT_RENDER_FAIL ${error.message}`);
  process.exitCode = 1;
});
