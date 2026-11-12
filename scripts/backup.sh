#!/bin/bash
# Export quotidien de PostgreSQL, 7 derniers fichiers conservés.
# Installation sur le serveur : (crontab -l 2>/dev/null; echo "0 3 * * * /home/deploy/app/scripts/backup.sh") | crontab -
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p ~/backups
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > ~/backups/hifrica_$(date +%F_%H%M).sql.gz
ls -1t ~/backups/*.sql.gz | tail -n +8 | xargs -r rm
