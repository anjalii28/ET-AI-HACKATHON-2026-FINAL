#!/bin/bash

# Helper script to run Chatwoot ticket ingestion
# This ensures the virtual environment is activated and dependencies are installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Chatwoot Ticket Ingestion"
echo "=============================="
echo ""

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "📦 Activating virtual environment..."
    source venv/bin/activate
else
    echo "⚠️  No virtual environment found. Using system Python."
    echo "   Consider creating one: python3 -m venv venv"
fi

# Check if required packages are installed
echo "🔍 Checking dependencies..."
python -c "import requests; import dotenv" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📥 Installing required packages..."
    pip install -q requests python-dotenv
fi

# Check if .env file exists and has Chatwoot config
if [ ! -f ".env" ]; then
    echo "⚠️  WARNING: .env file not found!"
    echo "   Please create .env file with Chatwoot credentials"
    exit 1
fi

if ! grep -q "CHATWOOT_API_TOKEN" .env; then
    echo "⚠️  WARNING: CHATWOOT_API_TOKEN not found in .env"
    echo "   Please add Chatwoot credentials to .env file"
    exit 1
fi

echo "✅ Configuration verified"
echo ""

# Run the script
echo "🔄 Processing tickets..."
echo ""
python send_to_chatwoot.py
