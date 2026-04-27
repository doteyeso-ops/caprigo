# Agent Skills (`SKILL.md`)

Caprigo loads [Agent Skills](https://agentskills.io/specification)-style playbooks from this directory tree. Some are native Caprigo playbooks; others are imported upstream playbooks adapted for Caprigo usage.

## Layout

```
skills/agentskills/
  imported-hermes/           # Imported Hermes skill tree (vendored + Caprigo notes)
    CAPRIGO.md               # Imported Hermes -> Caprigo tool mapping cheatsheet
    NOTICE.md                # Upstream MIT + source link
    research/arxiv/SKILL.md
    mcp/native-mcp/SKILL.md
    ...
  my-custom/
    SKILL.md
```

- **YAML frontmatter** must include at least `name` and `description` (per agentskills.io).
- Each playbook becomes a tool named **`as_<name>`** (hyphens -> underscores), e.g. `as_arxiv`.
- **Calling the tool** returns the markdown body so the model can follow curl/API workflows. Upstream CLI commands in imported playbooks should be mapped to Caprigo tools (`execute_command`, `http_request`, MCP, etc.).
- **Large trees:** The full **`imported-hermes/`** copy registers many `as_*` tools. Use **Assign skills** per session to avoid overloading small models.

## Imported Hermes bundle

The **`imported-hermes/`** subtree is derived from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT). Each `SKILL.md` ends with a **Caprigo Core (adaptation)** footer; high-traffic skills also include a **Caprigo playbook (extended)** section (see the list in **`imported-hermes/CAPRIGO.md`**). Read **`imported-hermes/CAPRIGO.md`** first when mapping upstream Hermes terminology to Caprigo.

To re-append the standard Caprigo footer after upstream edits (idempotent):

```bash
node scripts/append-imported-hermes-caprigo-footers.mjs
```

## Refresh

After adding or editing files, use **Overview -> Runtime setup -> Refresh skills** (or restart the gateway).
