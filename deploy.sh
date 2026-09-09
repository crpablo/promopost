#!/usr/bin/env bash
# Rodar no VPS, dentro do diretório do projeto (/opt/promopost):
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull
docker compose up -d --build

# Aplica a migration do Postgres a cada deploy. O SQL usa "create table/index
# if not exists", entao e idempotente — nao precisa rastrear se ja rodou.
docker compose exec -T db psql -U promopost -d promopost < db/migrations/001_init.sql
