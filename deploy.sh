#!/usr/bin/env bash
# Rodar no VPS, dentro do diretório do projeto (/opt/promopost):
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull
docker compose up -d --build
