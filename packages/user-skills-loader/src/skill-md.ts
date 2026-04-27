/**
 * Minimal parser for agentskills.io-style SKILL.md (YAML frontmatter + Markdown body).
 * Tolerates nested YAML (metadata blocks) by stopping key reads at section boundaries.
 */

export type ParsedSkillMd = {
  frontmatter: Record<string, string>;
  body: string;
  /** agentskills.io `name` (reliable even with nested YAML below). */
  skillName?: string;
  /** agentskills.io `description` (first line only). */
  skillDescription?: string;
};

/** Split --- ... --- from first lines; returns null if no valid frontmatter block. */
export function parseSkillMd(raw: string): ParsedSkillMd | null {
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fmBlock = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const frontmatter = parseSimpleYamlScalars(fmBlock);
  const skillName = fmBlock.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const skillDescription = fmBlock.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  return {
    frontmatter,
    body,
    ...(skillName ? { skillName } : {}),
    ...(skillDescription ? { skillDescription } : {}),
  };
}

/**
 * Extract top-level `key: value` scalars; ignores nested blocks (lines indented under a key).
 */
function parseSimpleYamlScalars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    let val = m[2];
    if (val === '|' || val === '>' || val === '|-' || val === '>-' || val === '') {
      // Skip multiline / nested blocks (Hermes metadata:)
      i += 1;
      while (i < lines.length) {
        const ln = lines[i];
        if (/^[a-zA-Z0-9_-]+:\s*/.test(ln) && !/^\s+/.test(ln)) break;
        i += 1;
      }
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

export function toolNameFromAgentSkillPath(relPosix: string): string {
  const slug = relPosix
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('_')
    .replace(/-/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const base = slug || 'skill';
  return `as_${base}`.slice(0, 64);
}
