#!/usr/bin/env bash
# Start all services for Review Intelligence System
# Usage: ./start-all-services.sh

set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "Starting All Services"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 0
    else
        return 1
    fi
}

# Check PostgreSQL
echo -e "${YELLOW}Checking PostgreSQL...${NC}"
if check_port 5432; then
    echo -e "${GREEN}✓ PostgreSQL is running on port 5432${NC}"
else
    echo -e "${RED}✗ PostgreSQL is not running on port 5432${NC}"
    echo "  Please start PostgreSQL first:"
    echo "  - If using Docker: cd chatwoot && docker-compose up -d postgres"
    echo "  - Or start PostgreSQL service manually"
    echo ""
fi

# Check if reviews-service/.env exists
if [ ! -f "reviews-service/.env" ]; then
    echo -e "${YELLOW}⚠ reviews-service/.env not found${NC}"
    echo "  Creating from .env.example..."
    if [ -f "reviews-service/.env.example" ]; then
        cp reviews-service/.env.example reviews-service/.env
        echo -e "${YELLOW}  Please edit reviews-service/.env and add:${NC}"
        echo "    - GOOGLE_PLACES_API_KEY"
        echo "    - GEMINI_API_KEY (can copy from root .env)"
        echo ""
    else
        echo -e "${RED}  Error: .env.example not found${NC}"
        exit 1
    fi
fi

# Check if dashboard dependencies are installed
if [ ! -d "dashboard/node_modules" ]; then
    echo -e "${YELLOW}Installing dashboard dependencies...${NC}"
    cd dashboard
    npm install
    cd ..
fi

# Check if reviews-service dependencies are installed
if [ ! -d "reviews-service/node_modules" ]; then
    echo -e "${YELLOW}Installing reviews-service dependencies...${NC}"
    cd reviews-service
    npm install
    cd ..
fi

echo ""
echo "=========================================="
echo "Starting Services"
echo "=========================================="
echo ""

# Start Reviews Service
echo -e "${YELLOW}Starting Reviews Service (port 3003)...${NC}"
cd reviews-service
npm run start:dev > ../logs/reviews-service.log 2>&1 &
REVIEWS_PID=$!
cd ..
echo -e "${GREEN}✓ Reviews Service started (PID: $REVIEWS_PID)${NC}"
echo "  Logs: logs/reviews-service.log"
sleep 3

# Start Dashboard
echo -e "${YELLOW}Starting Dashboard (Vite)...${NC}"
cd dashboard
npm run dev > ../logs/dashboard.log 2>&1 &
DASHBOARD_PID=$!
cd ..
echo -e "${GREEN}✓ Dashboard started (PID: $DASHBOARD_PID)${NC}"
echo "  Logs: logs/dashboard.log"
sleep 4

# Create logs directory if it doesn't exist
mkdir -p logs

# Save PIDs to file for easy stopping
echo "$REVIEWS_PID" > logs/reviews-service.pid
echo "$DASHBOARD_PID" > logs/dashboard.pid

echo ""
echo "=========================================="
echo "Services Started Successfully!"
echo "=========================================="
echo ""
echo -e "${GREEN}Reviews Service:${NC} http://localhost:3003"
echo -e "${GREEN}Dashboard:${NC} http://localhost:5173/app/feedback"
echo ""
echo "If using NGINX proxy:"
echo "  Dashboard: http://localhost/app/feedback"
echo ""
echo "PIDs saved to:"
echo "  - logs/reviews-service.pid"
echo "  - logs/dashboard.pid"
echo ""
echo "To stop all services:"
echo "  ./stop-all-services.sh"
echo ""
echo "To view logs:"
echo "  tail -f logs/reviews-service.log"
echo "  tail -f logs/dashboard.log"
echo ""
echo "=========================================="
