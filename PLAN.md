# Plan

1. **Slice 1: Project Setup & CLI Skeleton**
   - Initialize package.json, TypeScript configs, and basic file structure.
   - Create a dummy CLI entrypoint that parses two modes: diff mode (default) and file mode (`--file <path>`).
   - *Verifiable by*: Running the CLI and seeing the correct mode/args printed.

2. **Slice 2: Input Extraction**
   - Implement `git diff` extraction.
   - Implement file reading for file mode.
   - *Verifiable by*: Running the CLI and seeing the extracted diff or file content printed to console.

3. **Slice 3: JUDGE.md Discovery**
   - Implement logic to find `JUDGE.md` files in `./.judge/judges/`.
   - Parse YAML frontmatter to get judge name/description and the markdown body for instructions.
   - *Verifiable by*: Creating a dummy test judge and seeing its parsed content logged.

4. **Slice 4: LLM Integration (`claude -p`)**
   - Construct a prompt combining the loaded judge instructions and the extracted input (diff/file).
   - Shell out to `claude -p "prompt"`.
   - *Verifiable by*: Seeing Claude's raw response in the terminal.

5. **Slice 5: SARIF Output Formatting**
   - Ask Claude to respond in JSON matching SARIF 2.1.0 (or parse standard response and wrap it into a SARIF template).
   - Ensure the final output is standard SARIF JSON.
   - *Verifiable by*: Outputting valid JSON that represents a SARIF format block.
