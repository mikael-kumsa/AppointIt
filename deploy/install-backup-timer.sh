#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd "$(dirname "$0")/.." && pwd)"
service_user="${SUDO_USER:-$USER}"

sudo tee /etc/systemd/system/appointit-backup.service >/dev/null <<EOF
[Unit]
Description=AppointIt PostgreSQL backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=${service_user}
WorkingDirectory=${app_dir}
ExecStart=/usr/bin/bash ${app_dir}/deploy/backup.sh
EOF

sudo tee /etc/systemd/system/appointit-backup.timer >/dev/null <<EOF
[Unit]
Description=Daily AppointIt PostgreSQL backup

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now appointit-backup.timer
systemctl list-timers appointit-backup.timer --no-pager
