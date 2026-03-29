#!/bin/bash

# Quick script to process audio files from OneDrive folder
# Based on the folder structure shown in the image

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONEDRIVE_BASE="/Users/anjali/Downloads/OneDrive_1_1-12-2026 2"

# Check if OneDrive folder exists
if [ ! -d "$ONEDRIVE_BASE" ]; then
    echo "ERROR: OneDrive folder not found at: $ONEDRIVE_BASE"
    echo ""
    echo "Please update the ONEDRIVE_BASE path in this script, or run manually:"
    echo "  python process_audio_batch.py --input /path/to/in --output /path/to/out"
    exit 1
fi

# Check if OneDrive base folder exists
if [ ! -d "$ONEDRIVE_BASE" ]; then
    echo "ERROR: OneDrive folder not found at: $ONEDRIVE_BASE"
    exit 1
fi

# Check if at least one input folder exists
if [ ! -d "$ONEDRIVE_BASE/in" ] && [ ! -d "$ONEDRIVE_BASE/out" ]; then
    echo "WARNING: No input folders found at: $ONEDRIVE_BASE"
    echo "Expected folders: in/ (incoming calls) and/or out/ (outgoing calls)"
    echo "Current contents:"
    ls -la "$ONEDRIVE_BASE"
    exit 1
fi

echo "Processing audio files from OneDrive..."
echo "Input folders:"
[ -d "$ONEDRIVE_BASE/in" ] && echo "  - Incoming: $ONEDRIVE_BASE/in"
[ -d "$ONEDRIVE_BASE/out" ] && echo "  - Outgoing: $ONEDRIVE_BASE/out"
echo "Output: $SCRIPT_DIR/output"
echo ""

# Activate virtual environment if it exists
if [ -d "$SCRIPT_DIR/venv" ]; then
    source "$SCRIPT_DIR/venv/bin/activate"
fi

# Run the Python script with --onedrive flag
python3 "$SCRIPT_DIR/process_audio_batch.py" --onedrive

# Check if processing was successful
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Processing complete!"
    echo ""
    echo "To view in dashboard, run:"
    echo "  export OUTPUT_FOLDER=\"$OUTPUT_FOLDER\""
    echo "  cd dashboard"
    echo "  npm run load-data"
    echo "  npm run dev"
fi
