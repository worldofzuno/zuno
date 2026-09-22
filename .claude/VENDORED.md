# Vendored content in .claude/

This tree mixes content from three sources. Know which is which before
editing, because a refresh from upstream overwrites vendored files.

## 1. shanraisshan/claude-code-best-practice

MIT, © 2025-2026 Shayan Rais. Revision `7a7644c` (2026-09-22).
<https://github.com/shanraisshan/claude-code-best-practice>

- `settings.json`, `.gitignore`
- `hooks/` — handler, config, 74 sound files
- `rules/` — `markdown-docs.md`, `presentation.md`
- `commands/` — all 10
- `agents/` — `weather-agent`, `time-agent`, `presentation-*`,
  `development-workflows-research-agent`, `workflows/`
- `skills/` — `agent-browser`, `time-skill`, `weather-fetcher`,
  `weather-svg-creator`, `presentation/`
- `agent-memory/weather-agent/`

Upstream calls this a course, not a package: the weather, time and
presentation pieces are tutorial demos kept as-is.

## 2. itallstartedwithaidea/agency-agents

MIT, © 2025 AgentLand Contributors. Revision `66f20e0` (2026-04-12).
See `agents/README.md` for the details.

- `agents/` — the 68 files prefixed `design-`, `engineering-`,
  `marketing-`, `product-`, `project-`, `testing-`, `support-`, plus
  the unprefixed specialized ones

## 3. This repo's own

- `skills/ui-ux-pro-max/`
