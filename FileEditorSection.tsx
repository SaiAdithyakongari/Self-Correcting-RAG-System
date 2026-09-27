import React, { useState, useRef, useMemo } from 'react';
import {
  Code,
  FileText,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Copy,
  Download,
  RotateCcw,
  History,
  Columns,
  List,
  ShieldCheck,
  ChevronRight,
  Database,
  ArrowRight,
  RefreshCw,
  FileCode,
  Check,
  Eye,
  Plus
} from 'lucide-react';
import {
  ActiveFileSession,
  FileIteration,
  SyntaxValidationResult,
  DiffResult,
} from '../types/fileEditor';
import { computeLineDiff } from '../utils/diffEngine';
import { FileEditorClient } from '../utils/fileEditorClient';
import { ClientRAGEngine } from '../utils/ragEngine';

interface FileEditorSectionProps {
  ragEngine?: ClientRAGEngine;
  onIndexedToRAG?: () => void;
}

// Built-in benchmark test samples for instant testing
const PRELOADED_SAMPLES = [
  {
    name: 'calculate_tax.py (Intentional Syntax Error)',
    filename: 'calculate_tax.py',
    content: `def calculate_bracket_tax(income, tax_rate
    # Intentional syntax error above (missing closing parenthesis)
    standard_deduction = 12500
    taxable_income = max(0, income - standard_deduction)
    total_tax = taxable_income * tax_rate
    return round(total_tax, 2)

def generate_tax_report(client_name, income, rate):
    tax_owed = calculate_bracket_tax(income, rate)
    return f"Client {client_name}: Income \${income}, Tax Owed: \${tax_owed}"
`,
    prompt: 'Fix the syntax error on line 1 while keeping everything else unchanged',
    category: 'Syntax Error Fix',
  },
  {
    name: 'order_processor.py (Feature Modification)',
    filename: 'order_processor.py',
    content: `def process_customer_order(order_id, items, discount_code):
    subtotal = sum(item["price"] * item.get("quantity", 1) for item in items)
    
    if discount_code == "VIP20":
        discount = subtotal * 0.20
    else:
        discount = 0.0

    final_total = subtotal - discount
    return {
        "order_id": order_id,
        "subtotal": subtotal,
        "discount": discount,
        "total": round(final_total, 2)
    }
`,
    prompt: 'add input validation to this function to check that items is not empty and price is positive',
    category: 'Code Enhancement',
  },
  {
    name: 'user_analytics.ts (TypeScript Rename)',
    filename: 'user_analytics.ts',
    content: `interface UserProfile {
  userId: string;
  userName: string;
  email: string;
  loginCount: number;
}

export function formatUserProfile(user: UserProfile): string {
  return \`User \${user.userName} (ID: \${user.userId}) has logged in \${user.loginCount} times.\`;
}

export function verifyUserStatus(user: UserProfile): boolean {
  return user.loginCount > 0 && user.email.includes("@");
}
`,
    prompt: "rename all instances of 'user' to 'customer' in identifiers and parameters",
    category: 'Refactor / Rename',
  },
  {
    name: 'transactions.csv (CSV Date Format)',
    filename: 'transactions.csv',
    content: `TransactionID,Date,Merchant,Amount,Status
TX1001,09/24/2026,Acme Cloud,149.99,Completed
TX1002,09/25/2026,DevTools Inc,89.50,Completed
TX1003,09/26/2026,Database Hosting,320.00,Pending
`,
    prompt: 'convert this CSV date column from MM/DD/YYYY to ISO YYYY-MM-DD format',
    category: 'Data Format Conversion',
  },
];

export const FileEditorSection: React.FC<FileEditorSectionProps> = ({
  ragEngine,
  onIndexedToRAG,
}) => {
  const [session, setSession] = useState<ActiveFileSession | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified' | 'raw'>('side-by-side');
  const [diffBaseline, setDiffBaseline] = useState<'original' | 'previous'>('original');
  const [copied, setCopied] = useState(false);
  const [ragIndexedToast, setRagIndexedToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize a new session with an uploaded or sample file
  const loadFileIntoSession = async (name: string, content: string, initialPrompt?: string) => {
    setErrorMsg(null);
    setRagIndexedToast(null);

    const ext = name.slice(name.lastIndexOf('.')).toLowerCase() || '.txt';
    const validation = await FileEditorClient.validateSyntax(name, content);

    const initialIteration: FileIteration = {
      iterationId: `v0_${Date.now()}`,
      versionNumber: 0,
      timestamp: new Date().toLocaleTimeString(),
      prompt: 'Original Upload',
      content,
      explanation: 'Original uploaded file loaded without modifications.',
      changesSummary: ['Source file loaded in pristine state.'],
      validation: validation || {
        valid: true,
        language: ext.slice(1).toUpperCase(),
        checkedWith: 'Initial Inspector',
      },
      retried: false,
    };

    setSession({
      sessionId: `sess_${Date.now()}`,
      filename: name,
      fileType: ext,
      originalContent: content,
      iterations: [initialIteration],
      currentVersionIndex: 0,
    });

    if (initialPrompt) {
      setPrompt(initialPrompt);
    } else {
      setPrompt('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      loadFileIntoSession(file.name, text || '');
    };
    reader.readAsText(file);
    // Reset file input so same file can be uploaded again if desired
    e.target.value = '';
  };

  // Currently viewed iteration and baseline for diff
  const currentIteration = useMemo(() => {
    if (!session || session.iterations.length === 0) return null;
    return session.iterations[session.currentVersionIndex] || session.iterations[0];
  }, [session]);

  const baselineContent = useMemo(() => {
    if (!session || !currentIteration) return '';
    if (diffBaseline === 'previous' && session.currentVersionIndex > 0) {
      return session.iterations[session.currentVersionIndex - 1].content;
    }
    return session.originalContent;
  }, [session, currentIteration, diffBaseline]);

  // Compute diff between baseline and current iteration
  const diffResult: DiffResult = useMemo(() => {
    if (!baselineContent && !currentIteration) {
      return {
        lines: [],
        stats: {
          origLineCount: 0,
          modLineCount: 0,
          addedLines: 0,
          deletedLines: 0,
          modifiedLines: 0,
          unchangedLines: 0,
          similarityRatio: 1,
        },
      };
    }
    return computeLineDiff(baselineContent, currentIteration?.content || '');
  }, [baselineContent, currentIteration]);

  // Execute Prompt Modification (Requirements 2, 3, 4, 5, 6, 7)
  const handleApplyModification = async () => {
    if (!session || !currentIteration || !prompt.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);
    setRagIndexedToast(null);

    try {
      const res = await FileEditorClient.modifyFile(
        session.filename,
        currentIteration.content,
        prompt.trim()
      );

      if (!res) {
        throw new Error('Failed connecting to file modification service.');
      }

      // Calculate diff stats against current iteration
      const iterationDiff = computeLineDiff(currentIteration.content, res.modifiedContent);

      const nextVersionNumber = session.iterations.length;
      const newIteration: FileIteration = {
        iterationId: `v${nextVersionNumber}_${Date.now()}`,
        versionNumber: nextVersionNumber,
        timestamp: new Date().toLocaleTimeString(),
        prompt: prompt.trim(),
        content: res.modifiedContent,
        explanation: res.explanation,
        changesSummary: res.changesSummary,
        validation: res.validation,
        retried: res.retried,
        diffStats: iterationDiff.stats,
      };

      setSession((prev) => {
        if (!prev) return null;
        const updatedIterations = [...prev.iterations, newIteration];
        return {
          ...prev,
          iterations: updatedIterations,
          currentVersionIndex: updatedIterations.length - 1,
        };
      });

      // Clear prompt input for follow-up prompt
      setPrompt('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error processing modification request.');
    } finally {
      setIsLoading(false);
    }
  };

  // Download Corrected File (Requirement 4)
  const handleDownload = () => {
    if (!session || !currentIteration) return;
    const blob = new Blob([currentIteration.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    // Add .modified before extension if version > 0
    const dotIndex = session.filename.lastIndexOf('.');
    let downloadName = session.filename;
    if (currentIteration.versionNumber > 0) {
      if (dotIndex !== -1) {
        downloadName = `${session.filename.slice(0, dotIndex)}.v${currentIteration.versionNumber}${session.filename.slice(dotIndex)}`;
      } else {
        downloadName = `${session.filename}.v${currentIteration.versionNumber}`;
      }
    }

    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy code to clipboard
  const handleCopy = () => {
    if (!currentIteration) return;
    navigator.clipboard.writeText(currentIteration.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Index into Knowledge Base (Requirement 8 - Opt-in explicit action)
  const handleIndexToRAG = () => {
    if (!ragEngine || !session || !currentIteration) return;

    const dotIndex = session.filename.lastIndexOf('.');
    let docName = session.filename;
    if (dotIndex !== -1) {
      docName = `${session.filename.slice(0, dotIndex)}_v${currentIteration.versionNumber}${session.filename.slice(dotIndex)}`;
    } else {
      docName = `${session.filename}_v${currentIteration.versionNumber}`;
    }

    const res = ragEngine.addDocument(docName, currentIteration.content);
    if (res.success) {
      setRagIndexedToast(`Successfully indexed '${docName}' (${res.chunksAdded} chunks) into RAG Knowledge Base!`);
      onIndexedToRAG?.();
    } else {
      setRagIndexedToast(`Failed indexing to RAG: ${res.error || 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Feature Header with Safety & Isolation Notice */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
                <FileCode className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-slate-900">Prompt-Based File Editor</h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                    Standalone Tool
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Static Validation Only
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload any code or text file, specify your desired modifications in natural language, review line-by-line diffs, and validate syntax before accepting.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Upload File to Edit</span>
            </button>
          </div>
        </div>

        {/* Security & RAG Isolation Banner (Requirements 7 & 8) */}
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
          <div className="flex items-center gap-2 text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Safety Guardrail: </strong> Code is only statically parsed (syntax-checked). Code execution is strictly prohibited.
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
            <Database className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>
              <strong>RAG Independence: </strong> Files edited here remain completely separate from the RAG knowledge base unless explicitly indexed.
            </span>
          </div>
        </div>
      </div>

      {/* Pre-loaded Benchmark Samples for Instant Testing */}
      {!session && (
        <div className="bg-slate-50/60 rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Quick Test Benchmarks (One-Click Sample Files)
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">Click any card to load test case</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PRELOADED_SAMPLES.map((sample, idx) => (
              <button
                key={idx}
                onClick={() => loadFileIntoSession(sample.filename, sample.content, sample.prompt)}
                className="text-left p-3.5 bg-white hover:bg-indigo-50/30 rounded-xl border border-slate-200 hover:border-indigo-300 transition-all shadow-2xs group cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[11px] font-bold text-slate-800 group-hover:text-indigo-600">
                      {sample.filename}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600">
                      {sample.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-2 italic">
                    "{sample.prompt}"
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-indigo-600 font-semibold">
                  <span>Load Sample</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Editor Workspace */}
      {session && (
        <div className="space-y-5">
          {/* File Header & Version Navigator (Requirement 6) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 text-slate-700 rounded-lg font-mono text-xs font-bold uppercase">
                {session.fileType.replace('.', '') || 'FILE'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 font-mono">{session.filename}</h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    ({session.originalContent.split('\n').length} lines original)
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span>Current: <strong>v{currentIteration?.versionNumber}</strong></span>
                  <span>•</span>
                  <span>{session.iterations.length} total versions recorded</span>
                </div>
              </div>
            </div>

            {/* Version History Selector Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
                <History className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-0.5" />
                {session.iterations.map((iter, idx) => {
                  const isActive = session.currentVersionIndex === idx;
                  const isOrig = iter.versionNumber === 0;

                  return (
                    <button
                      key={iter.iterationId}
                      onClick={() => setSession((s) => s ? { ...s, currentVersionIndex: idx } : null)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                        isActive
                          ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title={iter.prompt}
                    >
                      <span>v{iter.versionNumber}</span>
                      {isOrig ? (
                        <span className="text-[9px] opacity-70">(Orig)</span>
                      ) : (
                        iter.validation.valid ? (
                          <Check className="w-2.5 h-2.5 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setSession(null)}
                className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                title="Close file and reset session"
              >
                Close
              </button>
            </div>
          </div>

          {/* Prompt Input Form (Requirement 2 & 6) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>
                  Describe Desired Change for Version {session.currentVersionIndex + 1}
                </span>
              </label>
              <span className="text-[11px] text-slate-500">
                Applying on top of <strong>v{currentIteration?.versionNumber}</strong>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleApplyModification();
                  }
                }}
                placeholder="e.g., 'fix the syntax error on line 1', 'add try/except block around calculation', 'rename user to customer'"
                disabled={isLoading}
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all disabled:opacity-50"
              />

              <button
                onClick={handleApplyModification}
                disabled={isLoading || !prompt.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing & Validating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Apply Modification</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick Suggestion Chips */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px] text-slate-500">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">Suggested Prompts:</span>
              {[
                'Fix the syntax error while keeping logic untouched',
                'Add input validation checks to function arguments',
                'Wrap core logic with error handling try/except block',
                'Add clean docstrings explaining parameters and return values',
              ].map((chip, cIdx) => (
                <button
                  key={cIdx}
                  type="button"
                  onClick={() => setPrompt(chip)}
                  disabled={isLoading}
                  className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[10px] cursor-pointer"
                >
                  + {chip}
                </button>
              ))}
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Explanation & Validation Result Banner (Requirement 3 & 5) */}
          {currentIteration && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-900">
                    Version v{currentIteration.versionNumber} Summary
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    ({currentIteration.timestamp})
                  </span>
                  {currentIteration.retried && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      Self-Healed on Compile Retry
                    </span>
                  )}
                </div>

                {/* Static Syntax Validation Badge (Requirement 3 & 7) */}
                <div className="flex items-center gap-2">
                  {currentIteration.validation.valid ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Syntax Verified Clean ({currentIteration.validation.checkedWith})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                      Syntax Warning: {currentIteration.validation.error}
                    </span>
                  )}
                </div>
              </div>

              {/* Plain-Language Explanation */}
              <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/70 p-3 rounded-xl border border-slate-200/80">
                <p className="font-semibold text-slate-900 mb-1">
                  Prompt: <span className="font-normal italic">"{currentIteration.prompt}"</span>
                </p>
                <p className="text-slate-600">{currentIteration.explanation}</p>
                {currentIteration.changesSummary && currentIteration.changesSummary.length > 0 && (
                  <ul className="list-disc list-inside mt-2 space-y-0.5 text-slate-600 text-[11px]">
                    {currentIteration.changesSummary.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Action Toolbar (Requirement 4 & 8) */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
                {/* Diff Stats */}
                <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                  <span className="text-emerald-600 font-bold">+{diffResult.stats.addedLines} added</span>
                  <span className="text-rose-600 font-bold">-{diffResult.stats.deletedLines} removed</span>
                  <span className="text-indigo-600 font-bold">~{diffResult.stats.modifiedLines} modified</span>
                  <span>{diffResult.stats.unchangedLines} unchanged ({Math.round(diffResult.stats.similarityRatio * 100)}% preserved)</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleDownload}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors shadow-2xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download v{currentIteration.versionNumber}</span>
                  </button>

                  {ragEngine && currentIteration.versionNumber > 0 && (
                    <button
                      onClick={handleIndexToRAG}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition-colors cursor-pointer"
                      title="Optional: Index this modified version into RAG Knowledge Base"
                    >
                      <Database className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Index to RAG</span>
                    </button>
                  )}
                </div>
              </div>

              {ragIndexedToast && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center justify-between">
                  <span>{ragIndexedToast}</span>
                  <button
                    onClick={() => setRagIndexedToast(null)}
                    className="text-emerald-700 font-bold ml-2 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Diff View Container (Requirement 4) */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Columns className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-slate-800">
                  Diff Inspection View
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  Comparing v{currentIteration?.versionNumber} against{' '}
                  {diffBaseline === 'original' ? 'v0 (Original)' : `v${session.currentVersionIndex - 1}`}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Baseline Toggle if v > 1 */}
                {session.currentVersionIndex > 1 && (
                  <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg text-[11px]">
                    <button
                      onClick={() => setDiffBaseline('original')}
                      className={`px-2 py-0.5 rounded font-medium ${
                        diffBaseline === 'original' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                      }`}
                    >
                      vs Original (v0)
                    </button>
                    <button
                      onClick={() => setDiffBaseline('previous')}
                      className={`px-2 py-0.5 rounded font-medium ${
                        diffBaseline === 'previous' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                      }`}
                    >
                      vs Previous (v{session.currentVersionIndex - 1})
                    </button>
                  </div>
                )}

                {/* View Mode Toggle */}
                <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg text-[11px]">
                  <button
                    onClick={() => setViewMode('side-by-side')}
                    className={`px-2 py-0.5 rounded font-medium ${
                      viewMode === 'side-by-side' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Side-by-Side
                  </button>
                  <button
                    onClick={() => setViewMode('unified')}
                    className={`px-2 py-0.5 rounded font-medium ${
                      viewMode === 'unified' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Unified Diff
                  </button>
                  <button
                    onClick={() => setViewMode('raw')}
                    className={`px-2 py-0.5 rounded font-medium ${
                      viewMode === 'raw' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Raw Output
                  </button>
                </div>
              </div>
            </div>

            {/* View Mode 1: Side-by-Side View */}
            {viewMode === 'side-by-side' && (
              <div className="overflow-x-auto max-h-[550px] overflow-y-auto font-mono text-[11px] leading-relaxed custom-scrollbar">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-100/70 text-slate-500 border-b border-slate-200 text-left text-[10px] uppercase font-bold tracking-wider">
                      <th className="w-12 px-2 py-1.5 text-right border-r border-slate-200">#</th>
                      <th className="px-3 py-1.5 w-1/2 border-r border-slate-200">
                        {diffBaseline === 'original' ? 'Original Source File' : `Previous (v${session.currentVersionIndex - 1})`}
                      </th>
                      <th className="w-12 px-2 py-1.5 text-right border-r border-slate-200">#</th>
                      <th className="px-3 py-1.5 w-1/2">
                        Corrected Version (v{currentIteration?.versionNumber})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffResult.lines.map((line, idx) => {
                      const isMod = line.type === 'modify';
                      const isAdd = line.type === 'insert';
                      const isDel = line.type === 'delete';

                      return (
                        <tr
                          key={idx}
                          className={`border-b border-slate-100 hover:bg-slate-50/50 ${
                            isMod
                              ? 'bg-amber-50/20'
                              : isAdd
                              ? 'bg-emerald-50/20'
                              : isDel
                              ? 'bg-rose-50/20'
                              : ''
                          }`}
                        >
                          {/* Original Line Number */}
                          <td className="px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 text-[10px]">
                            {line.origLineNumber || ''}
                          </td>

                          {/* Original Text Pane */}
                          <td
                            className={`px-3 py-0.5 border-r border-slate-200 whitespace-pre font-mono ${
                              isMod
                                ? 'bg-amber-100/50 text-amber-950 font-medium'
                                : isDel
                                ? 'bg-rose-100/60 text-rose-950 line-through font-medium'
                                : 'text-slate-800'
                            }`}
                          >
                            {line.origText !== undefined ? line.origText : ''}
                          </td>

                          {/* Modified Line Number */}
                          <td className="px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 text-[10px]">
                            {line.modLineNumber || ''}
                          </td>

                          {/* Modified Text Pane */}
                          <td
                            className={`px-3 py-0.5 whitespace-pre font-mono ${
                              isMod
                                ? 'bg-emerald-100/60 text-emerald-950 font-medium'
                                : isAdd
                                ? 'bg-emerald-100/70 text-emerald-950 font-medium'
                                : 'text-slate-800'
                            }`}
                          >
                            {line.modText !== undefined ? line.modText : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* View Mode 2: Unified Diff View */}
            {viewMode === 'unified' && (
              <div className="p-4 bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed max-h-[550px] overflow-y-auto custom-scrollbar">
                <div className="text-slate-500 mb-2 pb-2 border-b border-slate-800">
                  --- a/{session.filename} (Original)
                  <br />
                  +++ b/{session.filename} (v{currentIteration?.versionNumber})
                </div>

                {diffResult.lines.map((line, idx) => {
                  if (line.type === 'equal') {
                    return (
                      <div key={idx} className="flex">
                        <span className="w-12 text-slate-600 select-none text-right pr-3">
                          {line.origLineNumber}
                        </span>
                        <span className="w-12 text-slate-600 select-none text-right pr-3">
                          {line.modLineNumber}
                        </span>
                        <span className="text-slate-400 select-none pr-2"> </span>
                        <span className="text-slate-300 whitespace-pre">{line.origText}</span>
                      </div>
                    );
                  }

                  if (line.type === 'modify') {
                    return (
                      <React.Fragment key={idx}>
                        <div className="flex bg-rose-950/60 text-rose-300">
                          <span className="w-12 text-rose-700 select-none text-right pr-3">
                            {line.origLineNumber}
                          </span>
                          <span className="w-12 select-none text-right pr-3"> </span>
                          <span className="text-rose-400 select-none pr-2">-</span>
                          <span className="whitespace-pre">{line.origText}</span>
                        </div>
                        <div className="flex bg-emerald-950/60 text-emerald-300">
                          <span className="w-12 select-none text-right pr-3"> </span>
                          <span className="w-12 text-emerald-700 select-none text-right pr-3">
                            {line.modLineNumber}
                          </span>
                          <span className="text-emerald-400 select-none pr-2">+</span>
                          <span className="whitespace-pre">{line.modText}</span>
                        </div>
                      </React.Fragment>
                    );
                  }

                  if (line.type === 'delete') {
                    return (
                      <div key={idx} className="flex bg-rose-950/60 text-rose-300">
                        <span className="w-12 text-rose-700 select-none text-right pr-3">
                          {line.origLineNumber}
                        </span>
                        <span className="w-12 select-none text-right pr-3"> </span>
                        <span className="text-rose-400 select-none pr-2">-</span>
                        <span className="whitespace-pre">{line.origText}</span>
                      </div>
                    );
                  }

                  // insert
                  return (
                    <div key={idx} className="flex bg-emerald-950/60 text-emerald-300">
                      <span className="w-12 select-none text-right pr-3"> </span>
                      <span className="w-12 text-emerald-700 select-none text-right pr-3">
                        {line.modLineNumber}
                      </span>
                      <span className="text-emerald-400 select-none pr-2">+</span>
                      <span className="whitespace-pre">{line.modText}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* View Mode 3: Raw Full Content */}
            {viewMode === 'raw' && (
              <div className="p-4 bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed max-h-[550px] overflow-y-auto custom-scrollbar">
                <pre className="whitespace-pre">{currentIteration?.content}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
