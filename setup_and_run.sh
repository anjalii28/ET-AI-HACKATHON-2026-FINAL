#!/bin/bash

# Setup script that creates virtual environment and runs the audio processor

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Setting up audio processing environment..."
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""

# Check if OneDrive folder path exists (in Downloads)
ONEDRIVE_BASE="/Users/anjali/Downloads/OneDrive_1_1-12-2026 2"

if [ -d "$ONEDRIVE_BASE/in" ] || [ -d "$ONEDRIVE_BASE/out" ]; then
    echo "Found OneDrive folder(s). Processing audio files..."
    echo ""
    python3 process_audio_batch.py --onedrive
else
    echo "OneDrive folder not found at: $ONEDRIVE_BASE"
    echo ""
    echo "Usage:"
    echo "  ./setup_and_run.sh"
    echo ""
    echo "Or run manually:"
    echo "  source venv/bin/activate"
    echo "  python3 process_audio_batch.py --onedrive"
    echo ""
    echo "Or specify custom folders:"
    echo "  python3 process_audio_batch.py --input /path/to/in --input /path/to/out"
fi
