import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only check the specific output folder
const PROJECT_ROOT = path.join(__dirname, '..');
// Use environment variable if set, otherwise default to relative path from project root
const OUTPUT_FOLDER = process.env.OUTPUT_FOLDER || path.join(PROJECT_ROOT, '..', 'output');

// Check if running in watch mode (for dev server)
const WATCH_MODE = process.argv.includes('--watch');

console.log(`Loading from: ${OUTPUT_FOLDER}`);
if (WATCH_MODE) {
  console.log('Watching for new files...');
}

const PUBLIC_DATA_PATH = path.join(PROJECT_ROOT, 'public', 'data');

// Ensure public/data directory exists
if (!fs.existsSync(PUBLIC_DATA_PATH)) {
  fs.mkdirSync(PUBLIC_DATA_PATH, { recursive: true });
}

// Function to load data
function loadData() {
  const allFiles = new Map();
  let outputFileCount = 0;

  if (!WATCH_MODE) {
    console.log('\nStarting data loading process...\n');
    console.log(`Checking output folder: ${OUTPUT_FOLDER}`);
  }

  if (fs.existsSync(OUTPUT_FOLDER)) {
    try {
      const allFilesInDir = fs.readdirSync(OUTPUT_FOLDER);
      const jsonFiles = allFilesInDir.filter(file => {
        const fullPath = path.join(OUTPUT_FOLDER, file);
        const isFile = fs.statSync(fullPath).isFile();
        return isFile && file.toLowerCase().endsWith('.json');
      });
      
      outputFileCount = jsonFiles.length;
      if (!WATCH_MODE) {
        console.log(`Found ${outputFileCount} JSON file(s) in output folder`);
      }
      
      jsonFiles.forEach(file => {
        allFiles.set(file, {
          source: 'output',
          path: path.join(OUTPUT_FOLDER, file)
        });
      });
    } catch (error) {
      console.error(`Error reading output folder:`, error.message);
    }
  } else {
    if (!WATCH_MODE) {
      console.warn(`Warning: "${OUTPUT_FOLDER}" folder not found.`);
    }
  }

  // Log summary
  if (!WATCH_MODE) {
    console.log('\nLoading Summary:');
    console.log(`   Files from output/: ${outputFileCount}`);
  }

  // Check if we have any files
  if (allFiles.size === 0) {
    if (!WATCH_MODE) {
      console.warn('\nNo JSON files found in output folder.');
      console.warn('   The app will work with any JSON files you place in public/data/ folder.');
      console.log('   Continuing with dev server startup...\n');
    }
    return 0;
  }

  const totalFiles = allFiles.size;
  if (!WATCH_MODE) {
    console.log(`   Total files: ${totalFiles}`);
    console.log('');
  }

  // Create manifest file listing all files
  const manifest = {
    files: Array.from(allFiles.keys()).sort(), // Sort for consistent ordering
    generatedAt: new Date().toISOString(),
    totalFiles: allFiles.size,
    sourcePath: OUTPUT_FOLDER
  };

  // Write manifest file
  fs.writeFileSync(
    path.join(PUBLIC_DATA_PATH, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  if (!WATCH_MODE) {
    console.log(`Created manifest.json with ${allFiles.size} unique file(s)`);
  }

  // Copy all unique files to public/data/
  let copiedCount = 0;
  let skippedCount = 0;
  const skippedFiles = [];
  
  allFiles.forEach((fileInfo, filename) => {
    try {
      const destPath = path.join(PUBLIC_DATA_PATH, filename);
      fs.copyFileSync(fileInfo.path, destPath);
      copiedCount++;
    } catch (error) {
      console.error(`Error copying ${filename}:`, error.message);
      skippedCount++;
      skippedFiles.push(filename);
    }
  });

  if (WATCH_MODE) {
    console.log(`Updated: ${copiedCount} file(s) available (${totalFiles} total)`);
  } else {
    console.log(`Copied ${copiedCount} file(s) to public/data/`);
    if (skippedCount > 0) {
      console.warn(`Skipped ${skippedCount} file(s) due to errors:`, skippedFiles.join(', '));
    }
    
    console.log('\nFinal Counts:');
    console.log(`   Total files loaded: ${totalFiles}`);
    console.log(`   Successfully copied: ${copiedCount}`);
    if (skippedCount > 0) {
      console.log(`   Failed to copy: ${skippedCount}`);
    }
    console.log(`\nData loading complete! Loaded ${totalFiles} file(s) from output folder.\n`);
  }

  return totalFiles;
}

// Watch for file changes if in watch mode
if (WATCH_MODE && fs.existsSync(OUTPUT_FOLDER)) {
  // Initial load message
  const initialCount = loadData();
  console.log(`\nWatching ${OUTPUT_FOLDER} for changes...`);
  console.log(`   Currently loaded: ${initialCount} file(s)`);
  console.log('   (New JSON files will be automatically loaded)');
  console.log('   (Press Ctrl+C to stop)\n');
  
  fs.watch(OUTPUT_FOLDER, { recursive: false }, (eventType, filename) => {
    if (filename && filename.toLowerCase().endsWith('.json')) {
      console.log(`\nDetected ${eventType}: ${filename}`);
      setTimeout(() => {
        loadData();
      }, 500); // Small delay to ensure file write is complete
    }
  });
  
  // Keep process alive
  process.stdin.resume();
} else if (!WATCH_MODE) {
  // Only run loadData if not in watch mode (watch mode calls it above)
  loadData();
}
