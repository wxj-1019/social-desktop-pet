#!/usr/bin/env bash
# ============================================================================
# Postgres 备份脚本（13.1/运维基线）
# - 每日全量 pg_dump（custom 格式，可选择性恢复）
# - 保留 30 天（对照 RETENTION.backupDays=30）
# - 生产建议：本脚本 + systemd timer 每日执行；异地冷备（R2/S3）另行配置
# 用法：BACKUP_DIR=/var/backups/pet ./deploy/backup-postgres.sh
# ============================================================================
set -euo pipefail

DB_URL="${DATABASE_URL:?需要 DATABASE_URL（postgres://user:pass@host:5432/pet）}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pet}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/pet-$STAMP.dump"

# custom 格式：支持 pg_restore 选择性恢复
pg_dump --format=custom --no-owner "$DB_URL" -f "$OUT"
echo "[backup] 完成: $OUT ($(du -h "$OUT" | cut -f1))"

# 清理过期备份
find "$BACKUP_DIR" -name 'pet-*.dump' -mtime "+$KEEP_DAYS" -delete
echo "[backup] 已清理 ${KEEP_DAYS} 天前的备份"

# 备份完整性冒烟：能读出文件头即认为有效（生产建议每周恢复演练）
pg_restore --list "$OUT" >/dev/null
echo "[backup] 完整性检查通过"
