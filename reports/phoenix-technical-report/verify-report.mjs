import { access, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const htmlPath = resolve(root, 'report.html');
const pdfPath = resolve(root, 'phoenix-technical-report.pdf');
const required = [
  'README.md',
  'docs/architecture.md',
  'docs/development.md',
  'docs/phoenix-windows.md',
  'SECURITY.md',
  'AGENTS.md',
  'package.json',
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function main() {
  await access(htmlPath);
  await access(pdfPath);
  const html = await readFile(htmlPath, 'utf8');
  const pdfInfo = await stat(pdfPath);
  assert(pdfInfo.size > 0, 'El PDF está vacío.');
  assert((html.match(/<section class="page(?:\s|\")/g) ?? []).length === 5, 'La fuente no contiene exactamente cinco páginas.');
  for (const heading of ['PHOENIX', 'Una sesión, varias capacidades coordinadas', 'Composición antes que núcleo privilegiado', 'Controles explícitos, límites visibles', 'De checkout a runtime verificable']) {
    assert(html.includes(heading), `Falta el encabezado: ${heading}`);
  }
  for (const marker of ['TODO', 'TBD', 'Lorem']) assert(!html.includes(marker), `Marcador incompleto detectado: ${marker}`);
  for (const source of required) assert(html.includes(`\`${source}\``), `Falta la fuente: ${source}`);
  assert((html.match(/<svg\b/g) ?? []).length >= 1, 'Falta un visual SVG.');
  assert((html.match(/role="img"/g) ?? []).length >= 1, 'Falta alternativa semántica para un visual.');
  console.log(`REPORT_VERIFY_PASS pages=5 bytes=${pdfInfo.size}`);
}

main().catch((error) => {
  console.error(`REPORT_VERIFY_FAIL ${error.message}`);
  process.exitCode = 1;
});
