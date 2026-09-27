import { SyntaxValidationResult } from '../types/fileEditor';

export interface ModifyFileResponse {
  modifiedContent: string;
  explanation: string;
  changesSummary: string[];
  validation: SyntaxValidationResult;
  retried: boolean;
}

export class FileEditorClient {
  public static async validateSyntax(
    filename: string,
    content: string
  ): Promise<SyntaxValidationResult | null> {
    try {
      const res = await fetch('/api/file-editor/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.success ? data.data : null;
    } catch (err) {
      console.warn('[FileEditorClient] Validate syntax error:', err);
      return null;
    }
  }

  public static async modifyFile(
    filename: string,
    content: string,
    prompt: string
  ): Promise<ModifyFileResponse | null> {
    try {
      const res = await fetch('/api/file-editor/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content, prompt }),
      });
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      const data = await res.json();
      return data?.success ? data.data : null;
    } catch (err) {
      console.warn('[FileEditorClient] Modify file error:', err);
      return null;
    }
  }
}
