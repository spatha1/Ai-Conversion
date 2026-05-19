#!/usr/bin/env bash
# deploy_vm.sh — Push latest local build to the Azure production VM
#
# Usage:
#   bash deploy_vm.sh           # pull + rebuild + restart on VM
#   bash deploy_vm.sh --no-build # pull only (if static/ is already committed)
#
# Run from the repo root on the LOCAL Windows machine (Git Bash or WSL).

set -e

VM_HOST="azureuser@104.211.112.63"
VM_KEY="$HOME/.ssh/azure_vm_key.pem"
VM_DIR="/home/azureuser/Ai-Conversion"

SKIP_BUILD=false
[[ "$1" == "--no-build" ]] && SKIP_BUILD=true

echo "==> Deploying to $VM_HOST ..."

ssh -i "$VM_KEY" -o StrictHostKeyChecking=no "$VM_HOST" bash <<REMOTE
set -e
cd $VM_DIR

echo "--- git pull ---"
git pull origin dev

if [ "$SKIP_BUILD" = false ]; then
  echo "--- npm install (if needed) ---"
  cd frontend
  npm install --silent
  echo "--- npm run build ---"
  npm run build
  cd ..
fi

echo "--- restart services ---"
sudo systemctl restart clarity-api
sudo systemctl restart nginx
sleep 2

echo "--- verify ---"
systemctl is-active clarity-api && echo "clarity-api: OK"
systemctl is-active nginx        && echo "nginx:       OK"
curl -s -o /dev/null -w "HTTP %{http_code} served from nginx\n" http://localhost/
REMOTE

echo ""
echo "==> Production deployment complete."
echo "    Public URL: http://104.211.112.63"
