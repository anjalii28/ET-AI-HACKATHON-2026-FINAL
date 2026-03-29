#!/bin/bash

# Setup script for Chatwoot local instance

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHATWOOT_DIR="$SCRIPT_DIR/chatwoot"

echo "Chatwoot Local Setup"
echo "==================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running!"
    echo "   Please start Docker Desktop and try again."
    exit 1
fi

echo "Docker is running ✓"
echo ""

# Navigate to chatwoot directory
cd "$CHATWOOT_DIR"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    
    # Generate SECRET_KEY_BASE
    echo ""
    echo "Generating SECRET_KEY_BASE..."
    SECRET_KEY=$(openssl rand -hex 64)
    
    # Update SECRET_KEY_BASE in .env
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/SECRET_KEY_BASE=.*/SECRET_KEY_BASE=$SECRET_KEY/" .env
    else
        # Linux
        sed -i "s/SECRET_KEY_BASE=.*/SECRET_KEY_BASE=$SECRET_KEY/" .env
    fi
    
    echo "✓ Generated SECRET_KEY_BASE"
else
    echo ".env file already exists"
fi

echo ""
echo "Starting Chatwoot services..."
echo "This may take a few minutes on first run..."
echo ""

# Start services
docker-compose up -d

echo ""
echo "Waiting for services to start..."
sleep 5

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo ""
    echo "✓ Chatwoot services are starting"
    echo ""
    echo "Services status:"
    docker-compose ps
    echo ""
    echo "Waiting for Chatwoot to initialize (this may take 2-3 minutes)..."
    echo "You can check logs with: cd chatwoot && docker-compose logs -f rails"
    echo ""
    echo "Once ready, access Chatwoot at:"
    echo "  http://localhost:3001"
    echo ""
    echo "Note: Using port 3001 to avoid conflict with Twenty CRM on port 3000"
    echo ""
    echo "Next steps:"
    echo "  1. Wait 2-3 minutes for initialization"
    echo "  2. Open http://localhost:3001"
    echo "  3. Create your admin account (first-time setup)"
    echo "  4. Create an API inbox (Settings → Inboxes → Add Inbox → API)"
    echo "  5. Get your API token (Profile → API Tokens → Generate New Token)"
    echo "  6. Update your .env file with:"
    echo "     CHATWOOT_API_URL=http://localhost:3001/api/v1"
    echo "     CHATWOOT_ACCOUNT_ID=<your-account-id>"
    echo "     CHATWOOT_API_TOKEN=<your-api-token>"
    echo "     CHATWOOT_INBOX_ID=<your-inbox-id>"
else
    echo ""
    echo "ERROR: Services failed to start"
    echo "Check logs with: cd chatwoot && docker-compose logs"
    exit 1
fi
