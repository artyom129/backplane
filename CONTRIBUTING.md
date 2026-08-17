# Contributing

Thank you for improving BACKPLANE. Keep changes focused, explain operational trade-offs, and add
tests for behavior that can fail silently.

## Local checks

```bash
make lint
make test
docker compose config --quiet
```

Schema changes require an Alembic migration. Do not create tables during application startup.
Frontend changes should preserve keyboard navigation and useful empty, loading, and error states.

## Pull requests

- Describe the user-visible or operational problem.
- Include migration and rollback notes where relevant.
- Never include real credentials, production webhook payloads, or customer data.
- Keep new outbound network paths behind the SSRF validation layer.

