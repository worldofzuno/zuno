# Agents

Vendored subagent definitions from [The Agency](https://github.com/itallstartedwithaidea/agency-agents)
(`itallstartedwithaidea/agency-agents`), MIT licensed, © 2025 AgentLand Contributors.

Source revision: `66f20e0d05bf24569c5093e21a835ac0530e2df6` (2026-04-12).

68 agents, copied from the upstream category folders (`design/`, `engineering/`,
`marketing/`, `product/`, `project-management/`, `testing/`, `support/`,
`spatial-computing/`, `specialized/`). Upstream's `strategy/` folder holds prose
docs rather than agent definitions and is intentionally not vendored.

They live here rather than in `~/.claude/agents/` — which is what upstream's
`scripts/install.sh` targets — so that every session on this repo picks them up,
including ephemeral web sessions that start from a fresh checkout.

To refresh, re-copy the category folders from a newer upstream revision and
update the revision above. Local edits to these files will be overwritten by
such a refresh.
