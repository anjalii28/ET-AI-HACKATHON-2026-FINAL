import os
import subprocess
from pathlib import Path

# Audio directory
AUDIO_DIR = Path("audio")

# Maximum duration in seconds (2 minutes = 120 seconds)
MAX_DURATION_SECONDS = 120

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
        print(f"  ⚠️  Could not get duration for {file_path.name}: {e}")
    return None

def main():
    print("🎵 Removing Long Audio Files")
    print("=" * 50)
    print(f"Audio directory: {AUDIO_DIR.resolve()}")
    print(f"Max duration: {MAX_DURATION_SECONDS} seconds (2 minutes)")
    print("=" * 50)
    
    # Check if audio directory exists
    if not AUDIO_DIR.exists():
        print(f"❌ ERROR: Audio directory '{AUDIO_DIR}' not found!")
        return
    
    # Check if ffprobe is available
    try:
        subprocess.run(["ffprobe", "-version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ ERROR: ffprobe not found. Please install ffmpeg:")
        print("   brew install ffmpeg")
        return
    
    # Find all audio files
    audio_extensions = ["*.wav", "*.WAV", "*.mp3", "*.MP3", "*.m4a", "*.M4A", "*.aac", "*.AAC"]
    audio_files = []
    for ext in audio_extensions:
        audio_files.extend(AUDIO_DIR.glob(ext))
    
    if not audio_files:
        print("❌ No audio files found in the audio directory!")
        return
    
    print(f"\n📊 Found {len(audio_files)} audio file(s)")
    print(f"⏱️  Checking durations...\n")
    
    files_to_remove = []
    files_to_keep = []
    
    for file_path in audio_files:
        duration = get_audio_duration(file_path)
        if duration is not None:
            if duration >= MAX_DURATION_SECONDS:
                files_to_remove.append((file_path, duration))
                print(f"  ✗ {file_path.name}: {duration:.2f}s (will be removed)")
            else:
                files_to_keep.append((file_path, duration))
                print(f"  ✓ {file_path.name}: {duration:.2f}s (keeping)")
        else:
            # If we can't get duration, keep the file to be safe
            files_to_keep.append((file_path, None))
            print(f"  ? {file_path.name}: Could not determine duration (keeping)")
    
    print(f"\n📋 Summary:")
    print(f"   Files to keep: {len(files_to_keep)}")
    print(f"   Files to remove: {len(files_to_remove)}")
    
    if not files_to_remove:
        print("\n✅ No files need to be removed!")
        return
    
    # Ask for confirmation (but we'll proceed since user requested it)
    print(f"\n🗑️  Removing {len(files_to_remove)} file(s)...")
    
    removed_count = 0
    for file_path, duration in files_to_remove:
        try:
            file_path.unlink()
            print(f"  ✅ Removed: {file_path.name} ({duration:.2f}s)")
            removed_count += 1
        except Exception as e:
            print(f"  ❌ Error removing {file_path.name}: {e}")
    
    print("\n" + "=" * 50)
    print(f"✅ Removal complete!")
    print(f"   Removed: {removed_count} file(s)")
    print(f"   Remaining: {len(files_to_keep)} file(s)")
    print("=" * 50)

if __name__ == "__main__":
    main()
