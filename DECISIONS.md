# Decisions Log

- **Language chosen**: TypeScript / Node.js (aligned with conversation choice for zero-friction `npx` distribution).
- **Execution model**: Shelling out to `claude -p` synchronously (mandated by SKILL.md; no API keys).
- **Format**: human-readable CLI OUTPUT for humans and JSON for agents.
