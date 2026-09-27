import React, { useState } from 'react';
import { Sparkles, Loader2, ArrowRight, BookOpen, Layers, CheckCircle } from 'lucide-react';
import { CorpusSummaryReport } from '../types/rag';
import { ClientRAGEngine } from '../utils/ragEngine';

interface SummarizerSectionProps {
  ragEngine: ClientRAGEngine;
  activeSummary: CorpusSummaryReport | null;
  onSetSummary: (summary: CorpusSummaryReport) => void;
  onSelectQuestion: (question: string) => void;
  docCount: number;
  onSummaryCompleted?: (report: CorpusSummaryReport) => void;
}

export const SummarizerSection: React.FC<SummarizerSectionProps> = ({
  ragEngine,
  activeSummary,
  onSetSummary,
  onSelectQuestion,
  docCount,
  onSummaryCompleted,
}) => {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  const handleGenerateSummary = async () => {
    if (docCount === 0) return;
    setIsSummarizing(true);
    setProgressMsg(`Analyzing ${docCount} document(s) in knowledge base...`);

    // Simulate multi-stage progress
    await new Promise((r) => setTimeout(r, 400));
    setProgressMsg('Extracting cross-document relational topics and entities...');
    await new Promise((r) => setTimeout(r, 450));
    setProgressMsg('Formulating content-grounded suggested test queries...');
    await new Promise((r) => setTimeout(r, 350));

    const report = ragEngine.summarizeCorpus();
    onSetSummary(report);
    if (onSummaryCompleted) {
      onSummaryCompleted(report);
    }
    setIsSummarizing(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                3. Document Summarization On-Demand
              </h2>
              <p className="text-xs text-slate-500">
                Generate per-document summaries, corpus synthesis, and test questions
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleGenerateSummary}
          disabled={isSummarizing || docCount === 0}
          className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-xs transition-all shrink-0 cursor-pointer"
        >
          {isSummarizing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{progressMsg}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>{activeSummary ? 'Regenerate Summary' : 'Generate Summary'}</span>
            </>
          )}
        </button>
      </div>

      {!activeSummary && !isSummarizing && (
        <div className="border border-dashed border-slate-200 rounded-lg p-5 text-center text-xs text-slate-500 bg-slate-50/50">
          <BookOpen className="w-6 h-6 mx-auto mb-2 text-slate-400" />
          <p className="font-medium text-slate-700">No active summary generated yet.</p>
          <p className="text-slate-500 mt-0.5">
            Click <strong>Generate Summary</strong> above to produce individual document abstracts,
            corpus relationships, and 2-3 clickable suggested questions based on indexed content.
          </p>
        </div>
      )}

      {isSummarizing && (
        <div className="p-6 rounded-lg bg-purple-50/60 border border-purple-200 text-center text-xs text-purple-900 animate-pulse">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-600" />
          <p className="font-semibold text-sm">{progressMsg}</p>
          <p className="text-purple-700 mt-1">Cross-referencing entities and semantic boundaries...</p>
        </div>
      )}

      {activeSummary && !isSummarizing && (
        <div className="space-y-4">
          {/* Corpus Relational Synthesis */}
          <div className="bg-purple-50/40 border border-purple-100 rounded-lg p-3.5 text-xs text-slate-800">
            <div className="flex items-center gap-1.5 font-bold text-purple-900 mb-1">
              <Layers className="w-3.5 h-3.5 text-purple-600" />
              <span>Corpus-Level Synthesis & Inter-Document Relationships:</span>
            </div>
            <p className="leading-relaxed text-slate-700">{activeSummary.corpus_summary}</p>
          </div>

          {/* Clickable Suggested Questions */}
          {activeSummary.suggested_questions.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>Suggested Questions (Click any to run through Self-Correcting RAG):</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {activeSummary.suggested_questions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSelectQuestion(q)}
                    className="text-left p-3 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-indigo-50/60 hover:border-indigo-300 text-xs text-slate-800 transition-all flex items-start justify-between group shadow-2xs cursor-pointer"
                  >
                    <span className="font-medium group-hover:text-indigo-900 pr-2">
                      💡 {q}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 shrink-0 mt-0.5" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Per-Document Summaries */}
          <div>
            <p className="text-xs font-bold text-slate-700 mb-2">
              Individual Document Highlights ({activeSummary.doc_summaries.length} files):
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
              {activeSummary.doc_summaries.map((ds) => (
                <div
                  key={ds.doc_id}
                  className="p-2.5 rounded-lg border border-slate-200/80 bg-white text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-800 truncate" title={ds.filename}>
                      📄 {ds.filename}
                    </span>
                    <span className="text-[10px] text-slate-400">{ds.chunk_count} chunks</span>
                  </div>
                  <p className="text-slate-600 text-[11px] leading-relaxed line-clamp-3">
                    {ds.summary}
                  </p>
                  {ds.key_entities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ds.key_entities.map((ent, ei) => (
                        <span
                          key={ei}
                          className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded"
                        >
                          {ent}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
