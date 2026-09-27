export interface SyntaxValidationResult {
  valid: boolean;
  error?: string;
  language: string;
  line?: number;
  offset?: number;
  checkedWith: string;
}

export interface DiffLine {
  type: 'equal' | 'insert' | 'delete' | 'modify';
  origLineNumber?: number;
  modLineNumber?: number;
  origText?: string;
  modText?: string;
}

export interface DiffStats {
  origLineCount: number;
  modLineCount: number;
  addedLines: number;
  deletedLines: number;
  modifiedLines: number;
  unchangedLines: number;
  similarityRatio: number;
}

export interface DiffResult {
  lines: DiffLine[];
  stats: DiffStats;
}

export interface FileIteration {
  iterationId: string;
  versionNumber: number; // 0 for original, 1 for v1, etc.
  timestamp: string;
  prompt: string;
  content: string;
  explanation: string;
  changesSummary: string[];
  validation: SyntaxValidationResult;
  retried: boolean;
  diffStats?: DiffStats;
}

export interface ActiveFileSession {
  sessionId: string;
  filename: string;
  fileType: string;
  originalContent: string;
  iterations: FileIteration[];
  currentVersionIndex: number;
}
