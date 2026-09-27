import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  X,
  FileText,
  Database,
  ExternalLink,
  Layers,
  Info,
  Lock,
  ArrowRight,
  HelpCircle,
  Undo2
} from 'lucide-react';
import {
  IndexedDocument,
  QualityIssue,
  SuggestedCorrection
} from '../types/rag';
import { ClientRAGEngine } from '../utils/ragEngine';

interface SuggestedCorrectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: IndexedDocument | null;
  ragEngine: ClientRAGEngine;
  onCorpusUpdated: () => void;
  selectedIssueId?: string | null;
}

export const SuggestedCorrectionsModal: React.FC<SuggestedCorrectionsModalProps> = ({
  isOpen,
  onClose,
  document: doc,
  ragEngine,
  onCorpusUpdated,
  selectedIssueId,
}) => {
  const [corrections, setCorrections] = useState<SuggestedCorrection[]>([]);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  // Generate / hydrate suggestions whenever document changes or modal opens
  useEffect(() => {
    if (isOpen && doc) {
      const generated = ragEngine.generateAllCorrectionsForDoc(doc.doc_id);
      setCorrections(generated);
      if (selectedIssueId) {
        setActiveIssueId(selectedIssueId);
      } else if (generated.length > 0) {
        setActiveIssueId(generated[0].issue_id);
      }
    }
  }, [isOpen, doc, selectedIssueId, ragEngine]);

  if (!isOpen || !doc) return null;

  const qr = doc.quality_report;
  const issues = qr?.issues || [];
  const acceptedCorrections = doc.accepted_corrections || [];

  const activeCorrection = corrections.find((c) => c.issue_id === activeIssueId);
  const activeIssue = issues.find((i) => i.issue_id === activeIssueId);

  const handleAccept = (correctionId: string) => {
    const success = ragEngine.acceptCorrection(doc.doc_id, correctionId);
    if (success) {
      setCorrections(ragEngine.generateAllCorrectionsForDoc(doc.doc_id));
      onCorpusUpdated();
    }
  };

  const handleReject = (correctionId: string) => {
    const success = ragEngine.rejectCorrection(doc.doc_id, correctionId);
    if (success) {
      setCorrections(ragEngine.generateAllCorrectionsForDoc(doc.doc_id));
      onCorpusUpdated();
    }
  };

  const getConfidenceBadge = (confidence: number, level: string) => {
    const pct = Math.round(confidence * 100);
    if (pct >= 80) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Confidence: {pct}% ({level})
        </span>
      );
    }
    if (pct >= 50) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          Confidence: {pct}% ({level})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
        Zero Evidence ({pct}%)
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900">
                  Review Suggested Corrections
                </h2>
                <span className="font-mono text-[11px] bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded">
                  {doc.filename}
                </span>
                {acceptedCorrections.length > 0 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-800 border border-violet-200">
                    {acceptedCorrections.length} Supplemented Draft Layer Active
                  </span>
                )}
              </div>
              <p className="text-slate-500 text-[11px] mt-0.5">
                Surfaces evidence-based gap repairs from other documents in the corpus. Never silently modifies original files.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Groundedness Guardrail Banner (Requirement 1 & 5) */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-[11px] text-amber-900 flex items-start gap-2">
          <Shield className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong>Groundedness Protocol: </strong>
            The original uploaded document and its indexed chunks are never overwritten or fabricated. Any accepted suggestion exists exclusively as a separate, clearly labeled supplemental draft annotation. All suggestions must be derived from verifiable evidence across the corpus.
          </div>
        </div>

        {/* Main Body: Two-column layout (Issue list on left, Suggestion details on right) */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12">
          {/* Left Column: Flagged Issues List */}
          <div className="md:col-span-4 border-r border-slate-200 p-4 overflow-y-auto space-y-2 bg-slate-50/50">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center justify-between">
              <span>Flagged Gaps ({issues.length})</span>
              <span className="text-[10px] text-indigo-600 font-normal">Select gap</span>
            </div>

            {issues.map((iss) => {
              const corr = corrections.find((c) => c.issue_id === iss.issue_id);
              const isAccepted = corr?.status === 'accepted';
              const isSelected = activeIssueId === iss.issue_id;

              return (
                <button
                  key={iss.issue_id}
                  onClick={() => setActiveIssueId(iss.issue_id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer flex flex-col gap-1 ${
                    isSelected
                      ? 'bg-white border-indigo-500 shadow-xs ring-1 ring-indigo-400'
                      : isAccepted
                      ? 'bg-violet-50/60 border-violet-200 hover:bg-white'
                      : 'bg-white/80 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 truncate max-w-[150px]">
                      {iss.location}
                    </span>
                    {isAccepted ? (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-violet-100 text-violet-800 border border-violet-200">
                        Accepted
                      </span>
                    ) : corr?.has_corpus_evidence ? (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                        Evidence Found
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600">
                        No Evidence
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    {iss.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Right Column: Detailed Suggestion & Review Card */}
          <div className="md:col-span-8 p-6 overflow-y-auto flex flex-col justify-between">
            {activeCorrection && activeIssue ? (
              <div className="space-y-4">
                {/* Mandatory Non-Dismissible AI Warning Badge (Requirement 3) */}
                <div className="flex items-center justify-between p-2.5 bg-amber-500/10 border border-amber-300 rounded-lg text-amber-950">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="font-bold text-[11px] tracking-wide uppercase">
                      AI-Suggested — Not Verified
                    </span>
                  </div>
                  {getConfidenceBadge(activeCorrection.confidence_score, activeCorrection.confidence_level)}
                </div>

                {/* Gap Specification */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                    Detected Gap
                  </span>
                  <div className="font-semibold text-slate-900 mb-0.5">
                    {activeCorrection.location}
                  </div>
                  <div className="text-slate-600 text-[11px] font-mono leading-relaxed">
                    {activeCorrection.gap_description}
                  </div>
                </div>

                {/* Suggestion Content / Honesty Gate Refusal */}
                {activeCorrection.has_corpus_evidence ? (
                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 block mb-1">
                        Proposed Supplemental Content
                      </span>
                      <div className="p-3.5 bg-indigo-50/40 border border-indigo-200 rounded-lg text-slate-800 font-mono text-[11px] whitespace-pre-wrap leading-relaxed shadow-2xs">
                        {activeCorrection.suggested_fill}
                      </div>
                    </div>

                    {/* Traceable Source Citation (Requirement 3 & 5) */}
                    <div className="p-3 bg-white rounded-lg border border-slate-200 text-[11px] space-y-1">
                      <div className="flex items-center justify-between text-slate-700 font-semibold">
                        <span className="flex items-center gap-1.5 text-indigo-900">
                          <Database className="w-3.5 h-3.5 text-indigo-600" />
                          Source Origin: {activeCorrection.source_document || 'Column Statistical Pattern'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {activeCorrection.source_type === 'cross_document'
                            ? 'Cross-Corpus Matching'
                            : 'Intra-Column Aggregation'}
                        </span>
                      </div>

                      {activeCorrection.source_excerpt && (
                        <div className="text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-100 font-mono text-[10px]">
                          "{activeCorrection.source_excerpt}"
                        </div>
                      )}

                      <div className="text-slate-600 text-[10px] pt-1">
                        <strong>Rationale: </strong> {activeCorrection.rationale}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Honesty Gate Refusal (Requirement 2 & 5) */
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-slate-700">
                    <div className="flex items-center gap-2 font-bold text-slate-800">
                      <Lock className="w-4 h-4 text-slate-500" />
                      <span>No Supporting Information Found in Corpus</span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {activeCorrection.suggested_fill}
                    </p>
                    <p className="text-[10px] text-slate-500 bg-white p-2 rounded border border-slate-200">
                      <strong>Honesty Gate Policy: </strong> The system refuses to invent or speculate missing data. Because no other uploaded document provides evidence to fill this gap, no ungrounded suggestions are presented for adoption.
                    </p>
                  </div>
                )}

                {/* Per-Suggestion Action Buttons (Requirement 4) */}
                <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                  <div className="text-[10px] text-slate-500 italic">
                    Requires explicit user approval per suggestion before adoption.
                  </div>

                  <div className="flex items-center gap-2">
                    {activeCorrection.status === 'accepted' ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-emerald-700 font-bold text-[11px] bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Accepted as Supplemental Draft
                        </span>
                        <button
                          onClick={() => handleReject(activeCorrection.correction_id)}
                          className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors cursor-pointer"
                        >
                          <Undo2 className="w-3 h-3" />
                          Revoke / Remove
                        </button>
                      </div>
                    ) : activeCorrection.has_corpus_evidence ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReject(activeCorrection.correction_id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => handleAccept(activeCorrection.correction_id)}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Accept Suggestion
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-mono">
                        No Action Available (Ungrounded)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                Select a gap on the left to review suggestions.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Accepted corrections create a separate draft annotation layer — original document remains pristine.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
