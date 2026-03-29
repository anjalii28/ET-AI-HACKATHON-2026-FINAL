#!/usr/bin/env bash
# Start dashboard and print what else to do for Nginx + Twenty.
# Usage: ./start-dashboard-and-notes.sh

set -e
cd "$(dirname "$0")"

echo "=== Starting Dashboard (Vite) ==="
cd dashboard
npm run dev &
VITE_PID=$!
cd ..

# Give Vite time to pick a port
sleep 4
# Detect port from process (optional; or just tell user to check terminal)
echo ""
echo "Dashboard dev server is starting in the background. Check the terminal for the port (e.g. http://localhost:5173/app/ or 5174)."
echo ""
echo "=== Next steps ==="
echo "1. Nginx (if you use it for http://localhost):"
echo "   - If nginx is installed (e.g. Homebrew):"
echo "     nginx -c \"$(pwd)/nginx.conf\""
echo "   - nginx.conf proxies /app to port 5174. If your Vite runs on 5173, edit nginx.conf and change 5174 to 5173."
echo "   - Then open: http://localhost/app"
echo ""
echo "2. Without Nginx: open the URL Vite printed (e.g. http://localhost:5174/app/)"
echo ""
echo "3. Leads iframe (Twenty): In your Twenty project .env set:"
echo "   SERVER_URL=http://localhost:3002"
echo "   Then run Twenty on port 3002: yarn dev --port 3002"
echo ""
echo "Dashboard is running in the background (PID $VITE_PID). Stop with: kill $VITE_PID"
exit 0
