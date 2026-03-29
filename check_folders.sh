#!/bin/bash

# Script to check OneDrive folder structure and help identify where audio files should be

ONEDRIVE_BASE="/Users/anjali/Downloads/OneDrive_1_1-12-2026 2"

echo "🔍 Checking OneDrive Folder Structure"
echo "======================================"
echo ""
echo "Base folder: $ONEDRIVE_BASE"
echo ""

if [ ! -d "$ONEDRIVE_BASE" ]; then
    echo "❌ Base folder does not exist!"
    exit 1
fi

echo "📂 Folder structure:"
ls -la "$ONEDRIVE_BASE"
echo ""

# Check in/ folder
if [ -d "$ONEDRIVE_BASE/in" ]; then
    echo "✅ Found: in/ folder (for incoming calls)"
    AUDIO_COUNT=$(find "$ONEDRIVE_BASE/in" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) 2>/dev/null | wc -l | tr -d ' ')
    TOTAL_FILES=$(find "$ONEDRIVE_BASE/in" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "   Audio files: $AUDIO_COUNT"
    echo "   Total files: $TOTAL_FILES"
    if [ "$TOTAL_FILES" -gt 0 ] && [ "$AUDIO_COUNT" -eq 0 ]; then
        echo "   ⚠️  Found files but none are audio (.wav/.mp3)"
        echo "   Files found:"
        find "$ONEDRIVE_BASE/in" -type f 2>/dev/null | head -5 | sed 's/^/      /'
    fi
else
    echo "❌ Missing: in/ folder (for incoming calls)"
    echo "   Create it: mkdir -p \"$ONEDRIVE_BASE/in\""
fi
echo ""

# Check out/ folder
if [ -d "$ONEDRIVE_BASE/out" ]; then
    echo "✅ Found: out/ folder (for outgoing calls)"
    AUDIO_COUNT=$(find "$ONEDRIVE_BASE/out" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) 2>/dev/null | wc -l | tr -d ' ')
    TOTAL_FILES=$(find "$ONEDRIVE_BASE/out" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "   Audio files: $AUDIO_COUNT"
    echo "   Total files: $TOTAL_FILES"
    if [ "$TOTAL_FILES" -gt 0 ] && [ "$AUDIO_COUNT" -eq 0 ]; then
        echo "   ⚠️  Found files but none are audio (.wav/.mp3)"
        echo "   Files found:"
        find "$ONEDRIVE_BASE/out" -type f 2>/dev/null | head -5 | sed 's/^/      /'
    fi
else
    echo "❌ Missing: out/ folder (for outgoing calls)"
    echo "   Create it: mkdir -p \"$ONEDRIVE_BASE/out\""
fi
echo ""

# Summary
TOTAL_AUDIO=$(find "$ONEDRIVE_BASE" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) 2>/dev/null | wc -l | tr -d ' ')

echo "======================================"
echo "📊 Summary:"
echo "   Total audio files found: $TOTAL_AUDIO"
echo ""

if [ "$TOTAL_AUDIO" -eq 0 ]; then
    echo "⚠️  No audio files found!"
    echo ""
    echo "To add audio files:"
    echo "   1. Copy .wav or .mp3 files to:"
    [ -d "$ONEDRIVE_BASE/in" ] && echo "      $ONEDRIVE_BASE/in"
    [ -d "$ONEDRIVE_BASE/out" ] && echo "      $ONEDRIVE_BASE/out"
    echo ""
    echo "   2. Then run: ./run_processor.sh"
else
    echo "✅ Ready to process! Run: ./run_processor.sh"
fi
