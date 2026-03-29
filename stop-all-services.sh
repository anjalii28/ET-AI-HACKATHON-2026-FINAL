#!/usr/bin/env bash
# Stop all services
# Usage: ./stop-all-services.sh

set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "Stopping all services..."
echo ""

# Stop Reviews Service
if [ -f "logs/reviews-service.pid" ]; then
    PID=$(cat logs/reviews-service.pid)
    if ps -p $PID > /dev/null 2>&1; then
        kill $PID 2>/dev/null || true
        echo -e "${GREEN}✓ Stopped Reviews Service (PID: $PID)${NC}"
    else
        echo -e "${YELLOW}Reviews Service was not running${NC}"
    fi
    rm -f logs/reviews-service.pid
else
    echo -e "${YELLOW}No Reviews Service PID file found${NC}"
fi

# Stop Dashboard
if [ -f "logs/dashboard.pid" ]; then
    PID=$(cat logs/dashboard.pid)
    if ps -p $PID > /dev/null 2>&1; then
        kill $PID 2>/dev/null || true
        echo -e "${GREEN}✓ Stopped Dashboard (PID: $PID)${NC}"
    else
        echo -e "${YELLOW}Dashboard was not running${NC}"
    fi
    rm -f logs/dashboard.pid
else
    echo -e "${YELLOW}No Dashboard PID file found${NC}"
fi

# Also kill any processes on the ports
echo ""
echo "Cleaning up processes on ports..."

# Kill process on port 3003 (Reviews Service)
if lsof -ti:3003 > /dev/null 2>&1; then
    lsof -ti:3003 | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}✓ Cleaned up port 3003${NC}"
fi

# Kill process on port 5173 (Dashboard)
if lsof -ti:5173 > /dev/null 2>&1; then
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}✓ Cleaned up port 5173${NC}"
fi

echo ""
echo -e "${GREEN}All services stopped!${NC}"
