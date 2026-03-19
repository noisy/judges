#!/usr/bin/env node
import mri from 'mri';
import { extractDiff } from './diff.js';
import { readFiles } from './files.js';

async function main() {
  const argv = process.argv.slice(2);
  const args = mri(argv, {
    string: ['file'],
    boolean: ['json', 'help'],
    alias: {
      f: 'file',
      j: 'json',
      h: 'help'
    }
  });

  if (args.help) {
    console.log(`
Usage: judge [options]

Options:
  --file, -f  Evaluate a specific file or files instead of git diff
  --json, -j  Output results in JSON format (for agents)
  --help, -h  Show this help message
    `);
    process.exit(0);
  }

  let inputContext = '';

  // Input extraction
  if (args.file) {
    inputContext = readFiles(args.file);
  } else {
    inputContext = extractDiff();
  }

  // Output for verification (Slice 1)
  console.log("--- Extracting Input (Slice 1 Verification) ---");
  console.log(inputContext.substring(0, 500) + (inputContext.length > 500 ? "...\n[truncated]" : ""));

  // The rest (Judges discovery, Prompt construction, Execution) will come in later slices.
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
