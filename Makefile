.PHONY: dev down logs test lint migrate seed build

dev:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f backend worker scheduler

test:
	docker compose run --rm backend sh -c 'pip install ".[dev]" && pytest'

lint:
	docker compose run --rm backend sh -c 'pip install ".[dev]" && ruff check app tests alembic && ruff format --check app tests alembic'
	docker compose run --rm --no-deps frontend npm run typecheck

migrate:
	docker compose run --rm migrate

seed:
	docker compose run --rm backend python -m app.seed

build:
	docker compose build
