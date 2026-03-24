import { executeLLM, Issue } from './llm.js';
import { constructPrompt } from './prompt.js';
import { JudgeProgress } from './ui.js';
import { SEVERITY_SCORE } from './config.js';

export async function runJudgesParallel(progressList: JudgeProgress[], inputContext: string, engine: 'claude' | 'codex' = 'claude'): Promise<any[]> {
  const promises = progressList.map(async (p) => {
    p.state = 'running';
    try {
      const prompt = constructPrompt(p.judge, inputContext);
      const issues = await executeLLM(prompt, engine);
      p.state = 'done';
      p.issues = issues;
      
      return { 
        judge: p.displayName, 
        file: p.judge.filePath, 
        issues 
      };
    } catch (error: any) {
      p.state = 'done';
      const errorIssue: Issue = {
        file: 'N/A',
        line: 'N/A',
        severity: 'high',
        message: `Execution Error: ${error.message}`
      };
      p.issues = [errorIssue];
      
      return { 
        judge: p.displayName, 
        file: p.judge.filePath, 
        issues: [errorIssue] 
      };
    }
  });

  const rawResults = await Promise.all(promises);

  // Separate sorting step
  for (const result of rawResults) {
    result.issues.sort((a: Issue, b: Issue) => {
      const scoreA = SEVERITY_SCORE[a.severity] || 0;
      const scoreB = SEVERITY_SCORE[b.severity] || 0;
      return scoreB - scoreA;
    });
  }

  return rawResults;
}
