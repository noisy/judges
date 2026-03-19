#!/usr/bin/env node
import mri from 'mri';
import { extractDiff } from './diff.js';
import { readFiles } from './files.js';
import { discoverJudges } from './judges.js';
import { constructPrompt } from './prompt.js';
import { executeLLM } from './llm.js';

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
  // console.log("--- Extracting Input (Slice 1 Verification) ---");
  // console.log(inputContext.substring(0, 500) + (inputContext.length > 500 ? "...\n[truncated]" : ""));

  // Execution and Formatting (Slice 3 & 4)
  const judges = discoverJudges();
  const results: any[] = [];
  
  if (!args.json) {
    console.log("--- Starting Judges Evaluation ---");
  }

  for (const j of judges) {
    if (!args.json) {
      console.log(`\nEvaluating with: ${j.name || j.id}...`);
    }
    
    // In json mode, we still need to prompt the LLM. 
    // Usually it takes time, so silence is fine for JSON mode until the end
    const prompt = constructPrompt(j, inputContext);
    const output = executeLLM(prompt);
    
    results.push({
      judge: j.name || j.id,
      file: j.filePath,
      review: output
    });

    if (!args.json) {
      console.log(`\n[${j.name || j.id} Feedback]\n${output}\n`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("--- Evaluation Complete ---");
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
