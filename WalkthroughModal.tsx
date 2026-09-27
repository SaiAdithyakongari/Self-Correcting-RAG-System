import React from 'react';
import { X, CheckCircle, ShieldAlert, RotateCw, BookOpen, Layers } from 'lucide-react';

interface WalkthroughModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalkthroughModal: React.FC<WalkthroughModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">How This System Works</h2>
              <p className="text-xs text-slate-500">Non-technical guide to Self-Correcting RAG</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs sm:text-sm text-slate-700 leading-relaxed">
          <div className="bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100">
            <h3 className="font-bold text-indigo-900 mb-1">Why Self-Correcting RAG?</h3>
            <p className="text-slate-700 text-xs">
              Traditional RAG (Retrieval-Augmented Generation) systems search for documents once and immediately synthesize an answer. If the retrieved documents do not contain the right facts, traditional systems often produce a plausible-sounding hallucination. Our system implements an automated evaluator that inspects every answer before you see it, automatically retrying retrieval if facts are missing.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-2">
              The 5-Step Pipeline Loop
            </h3>
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  1
                </span>
                <div>
                  <strong className="text-slate-900 text-xs">Retrieve:</strong> Your question is converted into mathematical vectors and compared against all document chunks to locate the most relevant sections.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  2
                </span>
                <div>
                  <strong className="text-slate-900 text-xs">Generate:</strong> The model crafts a direct answer with numbered citations (e.g. <code>[1]</code>, <code>[2]</code>) pointing to exact source chunks.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  3
                </span>
                <div>
                  <strong className="text-slate-900 text-xs">Evaluate:</strong> An automated judge audits every sentence in the response for <strong>Groundedness</strong> (proof from sources) and <strong>Relevance</strong> (answering the question).
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  4
                </span>
                <div>
                  <strong className="text-slate-900 text-xs">Self-Correct Retry:</strong> If either score is below 70%, the system automatically rephrases the query, widens the search context window, and retries (up to 3 cycles).
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  5
                </span>
                <div>
                  <strong className="text-slate-900 text-xs">Honesty Gate:</strong> If after 3 cycles the documents still don't support the answer, the system honestly states &ldquo;Insufficient evidence found&rdquo; rather than making up a fake answer.
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-2">
              Key Glossary Terms
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <strong>Groundedness:</strong> Percentage of claims directly supported by cited text without hallucination.
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <strong>Relevance:</strong> How directly the response addresses the user&apos;s specific question.
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <strong>Chunk:</strong> A clean 500-character section of a document stored with metadata.
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <strong>Similarity Score:</strong> Cosine match between question intent and chunk meaning (0-100%).
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
