#!/usr/bin/env bash
set -euo pipefail
npm install
npm run build
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "افتح من هذا الجهاز: http://localhost:3000"
echo "افتح من الهاتف والآيباد: http://${IP:-IP-الجهاز}:3000"
npm start
