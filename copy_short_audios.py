import os
import random
import shutil
from pathlib import Path
import subprocess

# Source directory - OneDrive folder
SOURCE_DIR = "/Users/anjali/Downloads/OneDrive_1_1-12-2026 2"

# Destination directory in current workspace
DEST_DIR = "audio"

# Maximum duration in seconds (2 minutes = 120 seconds)
MAX_DURATION_SECONDS = 120

# Number of files to select
NUM_FILES_TO_SELECT = 5

def get_audio_duration(file_path):
    """Get audio file duration in seconds using ffprobe."""
    try:
        # Use ffprobe to get duration
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            duration = float(result.stdout.strip())
            return duration
    except Exception as e:
        print(f"  ⚠️  Could not get duration for {os.path.basename(file_path)}: {e}")
    return None

def find_audio_files(source_dir):
    """Find all audio files recursively in the source directory."""
    audio_extensions = ["*.wav", "*.WAV", "*.mp3", "*.MP3", "*.m4a", "*.M4A", "*.aac", "*.AAC", "*.flac", "*.FLAC"]
    audio_files = []
    
    source_path = Path(source_dir)
    if not source_path.exists():
        print(f"❌ ERROR: Source directory not found: {source_dir}")
        return []
    
    for ext in audio_extensions:
        audio_files.extend(source_path.rglob(ext))
    
    return audio_files

def filter_files_by_duration(audio_files):
    """Filter audio files that are < 2 minutes."""
    valid_files = []
    
    print(f"  📊 Found {len(audio_files)} total audio files")
    print(f"  ⏱️  Checking durations (< {MAX_DURATION_SECONDS}s)...")
    
    for file_path in audio_files:
        duration = get_audio_duration(file_path)
        if duration is not None and duration < MAX_DURATION_SECONDS:
            valid_files.append((file_path, duration))
            print(f"    ✓ {file_path.name}: {duration:.2f}s")
        elif duration is not None:
            print(f"    ✗ {file_path.name}: {duration:.2f}s (too long)")
    
    print(f"  ✅ Found {len(valid_files)} files < {MAX_DURATION_SECONDS} seconds")
    return valid_files

def main():
    print("🎵 Audio File Selection Script")
    print("=" * 50)
    print(f"Source: {SOURCE_DIR}")
    print(f"Destination: {DEST_DIR}")
    print(f"Max duration: {MAX_DURATION_SECONDS} seconds (2 minutes)")
    print(f"Files to select: {NUM_FILES_TO_SELECT}")
    print("=" * 50)
    
    # Check if ffprobe is available
    try:
        subprocess.run(["ffprobe", "-version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ ERROR: ffprobe not found. Please install ffmpeg:")
        print("   brew install ffmpeg")
        return
    
    # Find all audio files
    print("\n🔍 Searching for audio files...")
    audio_files = find_audio_files(SOURCE_DIR)
    
    if not audio_files:
        print("❌ No audio files found in the source directory!")
        return
    
    # Filter files by duration
    valid_files_with_duration = filter_files_by_duration(audio_files)
    
    if not valid_files_with_duration:
        print("❌ No audio files found that are less than 2 minutes!")
        return
    
    # Extract just the file paths
    valid_files = [file_path for file_path, _ in valid_files_with_duration]
    
    # Select files
    if len(valid_files) <= NUM_FILES_TO_SELECT:
        print(f"\n📋 Selecting all {len(valid_files)} files (less than requested {NUM_FILES_TO_SELECT})")
        selected_files = valid_files
    else:
        print(f"\n🎲 Randomly selecting {NUM_FILES_TO_SELECT} files from {len(valid_files)} valid files")
        selected_files = random.sample(valid_files, NUM_FILES_TO_SELECT)
    
    # Create destination directory
    dest_path = Path(DEST_DIR)
    dest_path.mkdir(parents=True, exist_ok=True)
    
    # Copy selected files
    print(f"\n📁 Copying files to {DEST_DIR}/...")
    copied_count = 0
    for file_path in selected_files:
        dest_file_path = dest_path / file_path.name
        try:
            # If file already exists, add a number suffix
            counter = 1
            while dest_file_path.exists():
                stem = file_path.stem
                suffix = file_path.suffix
                dest_file_path = dest_path / f"{stem}_{counter}{suffix}"
                counter += 1
            
            shutil.copy2(file_path, dest_file_path)
            duration = next(d for f, d in valid_files_with_duration if f == file_path)
            print(f"  ✅ Copied: {file_path.name} ({duration:.2f}s)")
            copied_count += 1
        except Exception as e:
            print(f"  ❌ Error copying {file_path.name}: {e}")
    
    print("\n" + "=" * 50)
    print(f"✅ Selection complete!")
    print(f"📂 Copied {copied_count} file(s) to: {dest_path.resolve()}/")
    print("=" * 50)

if __name__ == "__main__":
    main()
