#!/bin/bash

# Simple script to run the audio processor with proper setup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Audio Processor Setup & Run"
echo "================================"
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
    echo ""
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source venv/bin/activate

# Check if packages are installed
if ! python3 -c "import dotenv" 2>/dev/null; then
    echo "📥 Installing required packages..."
    pip install -q -r requirements.txt
    echo "✅ Packages installed"
    echo ""
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  WARNING: .env file not found!"
    echo "   Please create .env file with: GEMINI_API_KEY=your_key_here"
    echo ""
    exit 1
fi

# Check OneDrive folder (in Downloads)
ONEDRIVE_BASE="/Users/anjali/Downloads/OneDrive_1_1-12-2026 2"

if [ ! -d "$ONEDRIVE_BASE" ]; then
    echo "⚠️  WARNING: OneDrive folder not found at: $ONEDRIVE_BASE"
    echo "   Please check the folder path"
    echo ""
    exit 1
fi

echo "📂 Checking for audio files..."
echo "   OneDrive folder: $ONEDRIVE_BASE"
echo ""

# Count audio files
AUDIO_COUNT=0
if [ -d "$ONEDRIVE_BASE/in" ]; then
    COUNT=$(find "$ONEDRIVE_BASE/in" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) 2>/dev/null | wc -l | tr -d ' ')
    echo "   📁 in/ folder: $COUNT audio file(s)"
    AUDIO_COUNT=$((AUDIO_COUNT + COUNT))
fi

if [ -d "$ONEDRIVE_BASE/out" ]; then
    COUNT=$(find "$ONEDRIVE_BASE/out" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) 2>/dev/null | wc -l | tr -d ' ')
    echo "   📁 out/ folder: $COUNT audio file(s)"
    AUDIO_COUNT=$((AUDIO_COUNT + COUNT))
fi

if [ "$AUDIO_COUNT" -eq 0 ]; then
    echo ""
    echo "⚠️  No audio files found!"
    echo "   Please add .wav or .mp3 files to:"
    [ -d "$ONEDRIVE_BASE/in" ] && echo "     - $ONEDRIVE_BASE/in"
    [ -d "$ONEDRIVE_BASE/out" ] && echo "     - $ONEDRIVE_BASE/out"
    echo ""
    exit 1
fi

echo ""
echo "🚀 Processing $AUDIO_COUNT audio file(s)..."
echo ""

# Run the processor
python3 process_audio_batch.py --onedrive

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Processing complete!"
    echo ""
    echo "📊 To view results in dashboard:"
    echo "   cd dashboard"
    echo "   npm run load-data"
    echo "   npm run dev"
fi

exit $EXIT_CODE
