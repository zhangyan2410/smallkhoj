SHELL := /bin/bash

.PHONY: install install-backend install-frontend verify-backend-env verify-frontend-env verify-e2e-env verify-release-source migration-check test test-backend test-frontend scripts-test twd-guard-test lint lint-backend lint-frontend typecheck build-frontend build-frontend-ci frontend-image-build backend-ci frontend-ci e2e-authenticated compose-check diff-check ci

FRONTEND_IMAGE_TAG ?= smallkhoj-frontend:audit-candidate
RELEASE_SOURCE_REVISION := $(shell git rev-parse --verify HEAD 2>/dev/null)

install: install-backend install-frontend

install-backend:
	cd backend && uv lock --check
	cd backend && uv sync --dev --locked

install-frontend:
	cd frontend && bun install --frozen-lockfile

verify-backend-env:
	@test "$$E2E_DATABASE_SCOPE" = "disposable" || { echo "E2E_DATABASE_SCOPE=disposable is required" >&2; exit 1; }
	@test -n "$$DATABASE_URL" || { echo "DATABASE_URL is required" >&2; exit 1; }
	@test -n "$$PUBLIC_API_KEY" || { echo "PUBLIC_API_KEY is required" >&2; exit 1; }
	@test -n "$$AUTH_BRIDGE_SECRET" || { echo "AUTH_BRIDGE_SECRET is required" >&2; exit 1; }
	@test -n "$$SMALLKHOJ_MIGRATION_TEST_ADMIN_URL" || { echo "SMALLKHOJ_MIGRATION_TEST_ADMIN_URL is required" >&2; exit 1; }
	@test -n "$$SMALLKHOJ_MIGRATION_TEST_DATABASE_URL" || { echo "SMALLKHOJ_MIGRATION_TEST_DATABASE_URL is required" >&2; exit 1; }
	@test -n "$$SMALLKHOJ_TEST_ADMIN_DATABASE_URL" || { echo "SMALLKHOJ_TEST_ADMIN_DATABASE_URL is required" >&2; exit 1; }
	@test -n "$$SMALLKHOJ_TEST_DATABASE_URL" || { echo "SMALLKHOJ_TEST_DATABASE_URL is required" >&2; exit 1; }
	python3 scripts/validate_delivery_env.py backend

verify-frontend-env:
	@test "$$NODE_ENV" = "production" || { echo "NODE_ENV=production is required" >&2; exit 1; }
	@test "$$NEXT_PUBLIC_DEPLOYMENT_ENV" = "production" || { echo "NEXT_PUBLIC_DEPLOYMENT_ENV=production is required" >&2; exit 1; }
	@test -n "$$NEXT_PUBLIC_API_KEY" || { echo "NEXT_PUBLIC_API_KEY is required" >&2; exit 1; }
	@test -n "$$INTERNAL_API_BASE_URL" || { echo "INTERNAL_API_BASE_URL is required" >&2; exit 1; }
	@test -n "$$BETTER_AUTH_SECRET" || { echo "BETTER_AUTH_SECRET is required" >&2; exit 1; }
	@test -n "$$BETTER_AUTH_URL" || { echo "BETTER_AUTH_URL is required" >&2; exit 1; }
	@test -n "$$BETTER_AUTH_DATABASE_URL" || { echo "BETTER_AUTH_DATABASE_URL is required" >&2; exit 1; }
	@test -n "$$AUTH_BRIDGE_SECRET" || { echo "AUTH_BRIDGE_SECRET is required" >&2; exit 1; }
	python3 scripts/validate_delivery_env.py frontend

verify-e2e-env:
	@test "$$E2E_DATABASE_SCOPE" = "disposable" || { echo "E2E_DATABASE_SCOPE=disposable is required" >&2; exit 1; }
	@test -n "$$DATABASE_URL" || { echo "DATABASE_URL is required" >&2; exit 1; }
	@test -n "$$BETTER_AUTH_DATABASE_URL" || { echo "BETTER_AUTH_DATABASE_URL is required" >&2; exit 1; }
	@test -n "$$E2E_PUBLIC_API_KEY" || { echo "E2E_PUBLIC_API_KEY is required" >&2; exit 1; }
	@test -n "$$E2E_RUN_NAMESPACE" || { echo "E2E_RUN_NAMESPACE is required" >&2; exit 1; }
	@test -n "$$API_BASE" || { echo "API_BASE is required" >&2; exit 1; }
	@test -n "$$FRONTEND_BASE" || { echo "FRONTEND_BASE is required" >&2; exit 1; }
	python3 scripts/validate_delivery_env.py e2e

migration-check: verify-backend-env
	cd backend && uv run alembic upgrade head
	cd backend && uv run alembic check

test: test-backend test-frontend scripts-test

test-backend:
	cd backend && uv run pytest -q

test-frontend:
	cd frontend && env NODE_ENV=test NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev NEXT_PUBLIC_API_KEY= bun run test

scripts-test: twd-guard-test
	python3 -m unittest discover -s scripts/tests -p 'test_*.py'

twd-guard-test:
	node --check tools/twd-guard/twd-auth-guard.mjs
	node --test tools/twd-guard/twd-auth-guard.test.mjs

lint: lint-backend lint-frontend

lint-backend:
	cd backend && uv run ruff check .

lint-frontend:
	cd frontend && bun run lint

typecheck:
	cd frontend && bun run typecheck
	cd frontend && bun run typecheck:e2e

build-frontend: build-frontend-ci

build-frontend-ci: verify-frontend-env
	cd frontend && bun run build
	test -f frontend/.next/standalone/server.js

verify-release-source:
	python3 scripts/production_image_transfer.py --check-source-only --source-revision "$(RELEASE_SOURCE_REVISION)"

frontend-image-build: verify-release-source verify-frontend-env
	python3 scripts/production_image_transfer.py --check-source-only --source-revision "$(RELEASE_SOURCE_REVISION)"
	@test -n "$$PUBLIC_API_KEY" || { echo "PUBLIC_API_KEY is required for the frontend image BuildKit secret" >&2; exit 1; }
	@test -n "$(FRONTEND_IMAGE_TAG)" || { echo "FRONTEND_IMAGE_TAG is required" >&2; exit 1; }
	DOCKER_BUILDKIT=1 docker build --no-cache --label org.opencontainers.image.revision="$(RELEASE_SOURCE_REVISION)" --secret id=public_api_key,env=PUBLIC_API_KEY -t "$(FRONTEND_IMAGE_TAG)" frontend
	python3 scripts/production_image_transfer.py --check-source-only --source-revision "$(RELEASE_SOURCE_REVISION)"
	@test "$$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$(FRONTEND_IMAGE_TAG)")" = "$(RELEASE_SOURCE_REVISION)" || { echo "Frontend image revision label must match the clean source HEAD" >&2; exit 1; }
	@test "$$(docker image inspect --format '{{.Config.User}}' "$(FRONTEND_IMAGE_TAG)")" = "bun" || { echo "Frontend image must run as the bun user" >&2; exit 1; }

backend-ci: install-backend migration-check lint-backend test-backend

frontend-ci: install-frontend verify-frontend-env test-frontend lint-frontend typecheck build-frontend-ci

e2e-authenticated: verify-e2e-env
	cd frontend && bun run e2e

compose-check:
	docker compose -f docker-compose.prod.yml config --no-interpolate --quiet

diff-check:
	git diff --check

# Runtime services are deliberately external to this deterministic command matrix.
# CI and local release scripts start isolated candidates before e2e-authenticated.
ci: scripts-test backend-ci frontend-ci compose-check diff-check
