/**
 * One-time / idempotent: append Caprigo adaptation footer to imported Hermes SKILL.md files
 * if not already present.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../skills/agentskills/imported-hermes');

const MARKER = '## Caprigo Core (adaptation)';

const FOOTER = `

---

${MARKER}

This playbook targets [Hermes Agent](https://github.com/NousResearch/hermes-agent). In **Caprigo Core**, map steps as follows:

- **Shell** -> Caprigo tool \`execute_command\` (optional \`cwd\`).
- **HTTP / APIs** -> \`http_request\` or curl via \`execute_command\`.
- **Repo files** -> filesystem tools such as \`read_file\`, \`list_directory\`, \`search_files\`.
- **MCP** (optional) -> tools named \`mcp_*\` from **Settings -> MCP servers**.
- **Hermes-only helpers** (e.g. web_extract) -> use HTTP + parsing or install upstream CLIs if required.

Cheatsheet: \`skills/agentskills/imported-hermes/CAPRIGO.md\`.
`;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (name.name === 'SKILL.md') out.push(p);
  }
  return out;
}

const files = walk(root);
let n = 0;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  if (t.includes(MARKER)) continue;
  fs.writeFileSync(f, t.trimEnd() + FOOTER, 'utf8');
  n += 1;
}
console.log(`Appended footer to ${n} SKILL.md files (${files.length} total).`);
