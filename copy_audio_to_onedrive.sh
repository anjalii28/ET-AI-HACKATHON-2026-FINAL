#!/bin/bash

# Helper script to copy audio files to OneDrive folders for processing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONEDRIVE_BASE="/Users/anjali/Downloads/OneDrive_1_1-12-2026 2"
PROJECT_AUDIO="$SCRIPT_DIR/audio"

echo "📋 Audio File Copy Helper"
echo "========================"
echo ""

# Check if OneDrive folders exist, create if not
mkdir -p "$ONEDRIVE_BASE/in"
mkdir -p "$ONEDRIVE_BASE/out"

echo "✅ OneDrive folders ready:"
echo "   - Incoming: $ONEDRIVE_BASE/in"
echo "   - Outgoing: $ONEDRIVE_BASE/out"
echo ""

# Check if project audio folder has files
if [ -d "$PROJECT_AUDIO" ]; then
    AUDIO_COUNT=$(find "$PROJECT_AUDIO" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) 2>/dev/null | wc -l | tr -d ' ')
    if [ "$AUDIO_COUNT" -gt 0 ]; then
        echo "📁 Found $AUDIO_COUNT audio file(s) in project audio folder"
        echo ""
        echo "Would you like to copy them to OneDrive folders?"
        echo "   (Files with 'inbound' or 'in_' in name → in/ folder)"
        echo "   (Files with 'outbound' or 'out_' in name → out/ folder)"
        echo ""
        read -p "Copy files? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            COPIED_IN=0
            COPIED_OUT=0
            
            find "$PROJECT_AUDIO" -type f \( -name "*.wav" -o -name "*.WAV" -o -name "*.mp3" -o -name "*.MP3" \) | while read file; do
                filename=$(basename "$file")
                if [[ "$filename" =~ (inbound|in_|INBOUND|IN_) ]]; then
                    cp "$file" "$ONEDRIVE_BASE/in/"
                    echo "  ✓ Copied to in/: $filename"
                    COPIED_IN=$((COPIED_IN + 1))
                elif [[ "$filename" =~ (outbound|out_|OUTBOUND|OUT_) ]]; then
                    cp "$file" "$ONEDRIVE_BASE/out/"
                    echo "  ✓ Copied to out/: $filename"
                    COPIED_OUT=$((COPIED_OUT + 1))
                else
                    # Default to in/ folder
                    cp "$file" "$ONEDRIVE_BASE/in/"
                    echo "  ✓ Copied to in/: $filename (default)"
                    COPIED_IN=$((COPIED_IN + 1))
                fi
            done
            
            echo ""
            echo "✅ Copy complete!"
        fi
    else
        echo "ℹ️  No audio files found in project audio folder"
    fi
fi

echo ""
echo "📝 Manual Instructions:"
echo "   1. Copy your incoming call audio files (.wav or .mp3) to:"
echo "      $ONEDRIVE_BASE/in"
echo ""
echo "   2. Copy your outgoing call audio files (.wav or .mp3) to:"
echo "      $ONEDRIVE_BASE/out"
echo ""
echo "   3. Then run: ./run_processor.sh"
echo ""
