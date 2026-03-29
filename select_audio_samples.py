import os
import random
import shutil
from pathlib import Path
import subprocess

# Source directory with classified calls
SOURCE_DIR = "/Users/anjali/Desktop/Filename-based routing/classified_calls"

# Destination directory in current workspace
DEST_DIR = "selected_audio_samples"

# Categories to process
CATEGORIES = ["APPOINTMENT", "CUSTOMER_CARE", "EMERGENCY", "OTHER", "POST_DISCHARGE"]

# Number of files to select per category
FILES_PER_CATEGORY = 25

# Minimum duration in seconds (2 minutes = 120 seconds)
MIN_DURATION_SECONDS = 120

def get_audio_duration(file_path):
    """Get audio file duration in seconds using ffprobe."""
    try:
        # Use ffprobe to get duration
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            duration = float(result.stdout.strip())
            return duration
    except Exception as e:
        print(f"  ⚠️  Could not get duration for {os.path.basename(file_path)}: {e}")
    return None

def filter_files_by_duration(category_dir):
    """Filter audio files that are >= 2 minutes."""
    valid_files = []
    files = list(Path(category_dir).glob("*.WAV")) + list(Path(category_dir).glob("*.wav"))
    
    print(f"  📊 Found {len(files)} total files")
    print(f"  ⏱️  Checking durations (>= {MIN_DURATION_SECONDS}s)...")
    
    for file_path in files:
        duration = get_audio_duration(str(file_path))
        if duration and duration >= MIN_DURATION_SECONDS:
            valid_files.append(file_path)
    
    print(f"  ✅ Found {len(valid_files)} files >= {MIN_DURATION_SECONDS} seconds")
    return valid_files

def select_random_files(files, count):
    """Randomly select files from the list."""
    if len(files) <= count:
        return files
    return random.sample(files, count)

def main():
    print("🎵 Audio File Selection Script")
    print("=" * 50)
    print(f"Source: {SOURCE_DIR}")
    print(f"Destination: {DEST_DIR}")
    print(f"Files per category: {FILES_PER_CATEGORY}")
    print(f"Minimum duration: {MIN_DURATION_SECONDS} seconds (2 minutes)")
    print("=" * 50)
    
    # Check if ffprobe is available
    try:
        subprocess.run(["ffprobe", "-version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ ERROR: ffprobe not found. Please install ffmpeg:")
        print("   brew install ffmpeg")
        return
    
    # Create destination directory
    os.makedirs(DEST_DIR, exist_ok=True)
    
    # Process each category
    for category in CATEGORIES:
        print(f"\n📁 Processing category: {category}")
        category_source = os.path.join(SOURCE_DIR, category)
        
        if not os.path.exists(category_source):
            print(f"  ⚠️  Category directory not found: {category_source}")
            continue
        
        # Filter files by duration
        valid_files = filter_files_by_duration(category_source)
        
        if len(valid_files) < FILES_PER_CATEGORY:
            print(f"  ⚠️  Only {len(valid_files)} files meet criteria, selecting all")
            selected_files = valid_files
        else:
            # Randomly select files
            selected_files = select_random_files(valid_files, FILES_PER_CATEGORY)
            print(f"  🎲 Randomly selected {len(selected_files)} files")
        
        # Create category directory in destination
        category_dest = os.path.join(DEST_DIR, category)
        os.makedirs(category_dest, exist_ok=True)
        
        # Copy selected files
        copied_count = 0
        for file_path in selected_files:
            dest_path = os.path.join(category_dest, file_path.name)
            try:
                shutil.copy2(file_path, dest_path)
                copied_count += 1
            except Exception as e:
                print(f"  ❌ Error copying {file_path.name}: {e}")
        
        print(f"  ✅ Copied {copied_count} files to {category_dest}")
    
    print("\n" + "=" * 50)
    print("✅ Selection complete!")
    print(f"📂 Selected files are in: {DEST_DIR}/")
    print("=" * 50)

if __name__ == "__main__":
    main()
