import React, { useState, useEffect } from 'react';
import {
  Search,
  RotateCw,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Layers,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  BookOpen,
  Sparkles,
  RefreshCw,
  Cpu
} from 'lucide-react';
import {
  PipelineResult,
  StageStatusUpdate,
  RetrievedChunkRecord,
  AttemptLog
} from '../types/rag';
import { ClientRAGEngine } from '../utils/ragEngine';

interface QueryPipelineSectionProps {
  ragEngine: ClientRAGEngine;
  selectedQuestion: string;
  onClearSelectedQuestion: () => void;
  onQueryCompleted: (result: PipelineResult) => void;
  groundednessThreshold: number;
  relevanceThreshold: number;
  maxRetries: number;
}

export const QueryPipelineSection: React.FC<QueryPipelineSectionProps> = ({
  ragEngine,
  selectedQuestion,
  onClearSelectedQuestion,
  onQueryCompleted,
  groundednessThreshold,
  relevanceThreshold,
  maxRetries,
}) => {
  const [questionInput, setQuestionInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [statusUpdate, setStatusUpdate] = useState<StageStatusUpdate | null>(null);
  const [activeCycle, setActiveCycle] = useState<number>(1);
  const [liveGroundedness, setLiveGroundedness] = useState<number | null>(null);
  const [liveRelevance, setLiveRelevance] = useState<number | null>(null);
  const [streamedAnswer, setStreamedAnswer] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [currentResult, setCurrentResult] = useState<PipelineResult | null>(null);

  // Traceability UI state
  const [selectedChunkHighlight, setSelectedChunkHighlight] = useState<string | null>(null);
  const [expandedTraceTab, setExpandedTraceTab] = useState<'chunks' | 'audit' | 'delta'>('chunks');

  // Sync selected question if user clicked a suggested question
  useEffect(() => {
    if (selectedQuestion) {
      setQuestionInput(selectedQuestion);
      onClearSelectedQuestion();
    }
  }, [selectedQuestion, onClearSelectedQuestion]);

  const handleRunRAG = async () => {
    const query = questionInput.trim();
    if (!query || isRunning) return;

    setIsRunning(true);
    setCurrentResult(null);
    setStreamedAnswer('');
    setIsStreaming(false);
    setSelectedChunkHighlight(null);
    setLiveGroundedness(null);
    setLiveRelevance(null);
    setActiveCycle(1);

    try {
      const result = await ragEngine.executePipeline(
        query,
        maxRetries,
        groundednessThreshold,
        relevanceThreshold,
        (update) => {
          setStatusUpdate(update);
          setActiveCycle(update.cycle);
          if (update.groundedness !== undefined) setLiveGroundedness(update.groundedness);
          if (update.relevance !== undefined) setLiveRelevance(update.relevance);
        }
      );

      setCurrentResult(result);

      // Stream the answer token-by-token
      setIsStreaming(true);
      const answerChars = result.final_answer;
      let streamed = '';
      const chunkSize = 3;

      for (let i = 0; i < answerChars.length; i += chunkSize) {
        streamed += answerChars.slice(i, i + chunkSize);
        setStreamedAnswer(streamed);
        await new Promise((r) => setTimeout(r, 12));
      }
      setIsStreaming(false);

      onQueryCompleted(result);
    } catch (err: any) {
      console.error('Pipeline error:', err);
    } finally {
      setIsRunning(false);
    }
  };

  // Helper for color-coding score cards
  const getScoreCardStyle = (score: number | null) => {
    if (score === null) return 'bg-slate-50 border-slate-200 text-slate-400';
    if (score >= 0.8) return 'bg-emerald-50 border-emerald-300 text-emerald-800';
    if (score >= 0.5) return 'bg-amber-50 border-amber-300 text-amber-800';
    return 'bg-rose-50 border-rose-300 text-rose-800';
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              4. Ask a Question with Real-Time Self-Correction
            </h2>
            <p className="text-xs text-slate-500">
              Iterative retrieve → generate → evaluate → retry loop with honesty gating
            </p>
          </div>
        </div>

        {/* Live Badge for Retries */}
        {isRunning && (
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full animate-pulse shadow-xs">
            <RotateCw className="w-3.5 h-3.5 animate-spin" />
            <span>
              Cycle {activeCycle} of {maxRetries}
            </span>
          </div>
        )}
      </div>

      {/* Query Input Bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={questionInput}
            onChange={(e) => setQuestionInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunRAG()}
            placeholder="Ask anything about the indexed documents (e.g., encryption standards, ARR metrics, quantum computing)..."
            disabled={isRunning}
            className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60 bg-slate-50/50 focus:bg-white transition-all shadow-2xs"
          />
        </div>
        <button
          onClick={handleRunRAG}
          disabled={isRunning || !questionInput.trim()}
          className="flex items-center justify-center gap-2 px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-xs transition-all cursor-pointer shrink-0"
        >
          {isRunning ? (
            <>
              <RotateCw className="w-4 h-4 animate-spin" />
              <span>Verifying ({activeCycle}/{maxRetries})...</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              <span>Run RAG Pipeline</span>
            </>
          )}
        </button>
      </div>

      {/* Real-time State & Metric Display */}
      {(isRunning || currentResult) && (
        <div className="mb-5 bg-slate-50/80 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200">
            {/* Stage-by-Stage Indicator */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-medium py-1">
              <span
                className={`px-2 py-1 rounded-md transition-all ${
                  statusUpdate?.stage === 'RETRIEVING'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                1. Retrieve (k={statusUpdate?.k || 4})
              </span>
              <span className="text-slate-400">→</span>
              <span
                className={`px-2 py-1 rounded-md transition-all ${
                  statusUpdate?.stage === 'GENERATING'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                2. Generate with Citations
              </span>
              <span className="text-slate-400">→</span>
              <span
                className={`px-2 py-1 rounded-md transition-all ${
                  statusUpdate?.stage === 'EVALUATING' || statusUpdate?.stage === 'CHECKING_GATE'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                3. Evaluate Groundedness
              </span>
              <span className="text-slate-400">→</span>
              <span
                className={`px-2 py-1 rounded-md transition-all ${
                  statusUpdate?.stage === 'RETRYING'
                    ? 'bg-amber-600 text-white font-bold animate-pulse'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                4. Self-Correct Retry
              </span>
              <span className="text-slate-400">→</span>
              <span
                className={`px-2 py-1 rounded-md transition-all ${
                  statusUpdate?.stage === 'COMPLETED'
                    ? 'bg-emerald-600 text-white font-bold'
                    : statusUpdate?.stage === 'HONESTY_GATE_ACTIVATED'
                    ? 'bg-rose-600 text-white font-bold'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                5. Final Output
              </span>
            </div>

            {/* Current Stage Message */}
            <div className="text-xs text-slate-600 italic">
              {statusUpdate?.message || 'Pipeline initialized'}
            </div>
          </div>

          {/* Metric Cards / Gauges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Groundedness Card */}
            <div
              className={`p-3 rounded-lg border transition-all ${getScoreCardStyle(
                liveGroundedness
              )}`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold flex items-center gap-1">
                  Groundedness
                  <span
                    title="Degree to which every claim in the answer is verified by retrieved text chunks (0-100%)."
                    className="cursor-help"
                  >
                    <HelpCircle className="w-3.5 h-3.5 opacity-70" />
                  </span>
                </span>
                <span className="text-[11px] opacity-80">
                  Target: {Math.round(groundednessThreshold * 100)}%
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black">
                  {liveGroundedness !== null ? `${Math.round(liveGroundedness * 100)}%` : '--'}
                </span>
                <span className="text-[11px] opacity-75">
                  {liveGroundedness !== null && liveGroundedness >= groundednessThreshold
                    ? 'Passed'
                    : liveGroundedness !== null
                    ? 'Below target'
                    : 'Awaiting eval'}
                </span>
              </div>
            </div>

            {/* Relevance Card */}
            <div
              className={`p-3 rounded-lg border transition-all ${getScoreCardStyle(
                liveRelevance
              )}`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold flex items-center gap-1">
                  Relevance
                  <span
                    title="Whether the answer directly addresses the intent of the user's question without digression."
                    className="cursor-help"
                  >
                    <HelpCircle className="w-3.5 h-3.5 opacity-70" />
                  </span>
                </span>
                <span className="text-[11px] opacity-80">
                  Target: {Math.round(relevanceThreshold * 100)}%
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black">
                  {liveRelevance !== null ? `${Math.round(liveRelevance * 100)}%` : '--'}
                </span>
                <span className="text-[11px] opacity-75">
                  {liveRelevance !== null && liveRelevance >= relevanceThreshold
                    ? 'Passed'
                    : liveRelevance !== null
                    ? 'Below target'
                    : 'Awaiting eval'}
                </span>
              </div>
            </div>

            {/* Honesty Gate Card */}
            <div className="p-3 rounded-lg border bg-white border-slate-200">
              <div className="flex items-center justify-between text-xs mb-1 text-slate-700">
                <span className="font-semibold flex items-center gap-1">
                  Honesty Gate
                  <span
                    title="Ensures low-confidence answers are safeguarded and reported honestly rather than hallucinated."
                    className="cursor-help"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </span>
                <span className="text-[11px] text-slate-500">
                  Cycle {activeCycle} of {maxRetries}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {statusUpdate?.stage === 'HONESTY_GATE_ACTIVATED' ||
                currentResult?.honesty_gate_triggered ? (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> Insufficient Evidence
                  </span>
                ) : currentResult?.passed ? (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> Verified Grounded
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <RotateCw className="w-3 h-3 animate-spin text-indigo-600" /> In Progress
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Synthesized Response Streaming Container */}
      {(streamedAnswer || isRunning) && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              Synthesized Answer with Chunk Citations
            </h3>
            {currentResult && (
              <span className="text-[11px] text-slate-500 font-mono">
                {currentResult.cycles_used} cycle(s) executed
              </span>
            )}
          </div>

          {/* User-Approved AI Suggestion Notice Banner (Requirement 4) */}
          {currentResult?.has_supplemented_chunks && (
            <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-2.5 text-xs shadow-2xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold flex items-center gap-1.5">
                  ⚠️ Traceability Notice: User-Approved AI Suggestion Utilized
                </span>
                <p className="mt-0.5 text-amber-800 text-[11px] leading-relaxed">
                  This answer uses a user-approved AI suggestion for missing data — original document did not contain this information directly.
                  {currentResult.supplemented_sources && currentResult.supplemented_sources.length > 0 && (
                    <span className="font-semibold block mt-0.5 text-amber-900">
                      Origin Citation: {currentResult.supplemented_sources.join(', ')}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          <div
            className={`p-4 rounded-xl border text-sm leading-relaxed ${
              currentResult?.honesty_gate_triggered
                ? 'bg-rose-50/50 border-rose-200 text-slate-800'
                : currentResult?.has_supplemented_chunks
                ? 'bg-amber-50/20 border-amber-200 text-slate-800 shadow-xs'
                : 'bg-white border-slate-200 text-slate-800 shadow-xs'
            }`}
          >
            {streamedAnswer ? (
              <div className="space-y-2 whitespace-pre-line">
                {streamedAnswer}
                {isStreaming && <span className="inline-block w-2 h-4 bg-indigo-600 ml-1 animate-pulse" />}
              </div>
            ) : (
              <div className="text-slate-400 text-xs italic flex items-center gap-2">
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                Synthesizing response and cross-verifying citations...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full Answer Traceability Panel */}
      {currentResult && (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold text-slate-900">Full Answer Traceability Panel</h3>
            </div>

            {/* Traceability Tabs */}
            <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg text-xs">
              <button
                onClick={() => setExpandedTraceTab('chunks')}
                className={`px-3 py-1 rounded-md transition-all font-medium ${
                  expandedTraceTab === 'chunks'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Retrieved Chunks ({currentResult.cited_chunks.length})
              </button>
              <button
                onClick={() => setExpandedTraceTab('audit')}
                className={`px-3 py-1 rounded-md transition-all font-medium ${
                  expandedTraceTab === 'audit'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Claim Audit ({currentResult.claims_analysis.length})
              </button>
              <button
                onClick={() => setExpandedTraceTab('delta')}
                className={`px-3 py-1 rounded-md transition-all font-medium ${
                  expandedTraceTab === 'delta'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Retry Delta Log ({currentResult.attempts.length})
              </button>
            </div>
          </div>

          <div className="p-4">
            {/* Tab 1: Retrieved Chunks with Text and Similarity Scores */}
            {expandedTraceTab === 'chunks' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 mb-2">
                  Numbered inline citations in the answer (e.g. <code>[1]</code>, <code>[2]</code>) correspond to the source chunks below:
                </p>
                <div className="grid grid-cols-1 gap-2.5 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                  {currentResult.cited_chunks.map((chk) => (
                    <div
                      key={chk.chunk_id}
                      onClick={() =>
                        setSelectedChunkHighlight(
                          selectedChunkHighlight === chk.chunk_id ? null : chk.chunk_id
                        )
                      }
                      className={`p-3 rounded-lg border text-xs transition-all cursor-pointer ${
                        selectedChunkHighlight === chk.chunk_id
                          ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-400'
                          : chk.is_supplemented
                          ? 'border-violet-300 bg-violet-50/30 hover:bg-violet-50/60'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                              chk.is_supplemented
                                ? 'bg-violet-100 text-violet-900 border border-violet-200'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            Source [{chk.rank}]
                          </span>
                          <span className="font-semibold text-slate-800">{chk.filename}</span>
                          <span className="text-[10px] text-slate-500">
                            (Chunk {chk.chunk_index} of {chk.total_chunks})
                          </span>

                          {chk.is_supplemented ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-800 bg-violet-100 border border-violet-300 px-1.5 py-0.2 rounded">
                              <Sparkles className="w-2.5 h-2.5 text-violet-600" />
                              User-Approved AI Suggestion
                            </span>
                          ) : chk.quality_status && chk.quality_status !== 'clean' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded">
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                              Data Quality Caveat
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                              ✓ Quality Clean
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono font-medium text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 shrink-0">
                          Similarity: {(chk.similarity_score * 100).toFixed(1)}%
                        </span>
                      </div>

                      {/* Supplemental Draft Explanation */}
                      {chk.is_supplemented && (
                        <div className="mb-2 p-2 rounded bg-violet-50 border border-violet-200 text-violet-950 text-[11px] flex items-start gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-violet-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <span className="font-bold">Supplemental Draft Annotation: </span>
                            <span className="leading-snug">
                              This answer chunk was generated from a user-approved AI suggestion to patch missing data. The original document did not contain this information directly.
                              {chk.supplement_source && (
                                <span className="block mt-0.5 font-mono text-[10px] text-violet-700">
                                  Evidence Origin: {chk.supplement_source}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Requirement 5: Surface data quality issues relevant to this chunk */}
                      {!chk.is_supplemented && (chk.quality_alert || (chk.quality_status && chk.quality_status !== 'clean')) && (
                        <div className="mb-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <span className="font-bold text-amber-950">Data Quality Alert: </span>
                            <span className="leading-snug">
                              {chk.quality_alert ||
                                `Note: this source document had incomplete data (${chk.quality_summary || 'missing or empty values'}) — treat with caution.`}
                            </span>
                          </div>
                        </div>
                      )}

                      <p className="text-slate-700 leading-relaxed font-mono text-[11px] bg-white p-2 rounded border border-slate-100">
                        {chk.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 2: Claim Audit */}
            {expandedTraceTab === 'audit' && (
              <div className="space-y-2">
                <div className="p-2.5 bg-slate-50 rounded-lg text-xs text-slate-700 mb-3 border border-slate-200">
                  <strong>Evaluator Rationale:</strong> {currentResult.evaluation_explanation}
                </div>
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                  {currentResult.claims_analysis.map((claim) => (
                    <div
                      key={claim.claim_id}
                      className="p-2.5 rounded-lg border border-slate-200 text-xs bg-white"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-800">
                          Claim #{claim.claim_id}: &ldquo;{claim.text}&rdquo;
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            claim.status === 'SUPPORTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : claim.status === 'PARTIALLY_SUPPORTED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {claim.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">{claim.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Retry Delta Log */}
            {expandedTraceTab === 'delta' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Chronological progression of automated retrieval attempts and strategy changes:
                </p>
                <div className="space-y-2.5">
                  {currentResult.attempts.map((att) => (
                    <div
                      key={att.cycle_number}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-800">
                          Cycle {att.cycle_number}: {att.strategy_description}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          k={att.k_used} chunks
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mb-1">
                        <strong>Query Text:</strong> &ldquo;{att.query_used}&rdquo;
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-700">
                        <span>
                          Groundedness: {Math.round(att.evaluation.groundedness_score * 100)}%
                        </span>
                        <span>Relevance: {Math.round(att.evaluation.relevance_score * 100)}%</span>
                        <span
                          className={`font-semibold ${
                            att.evaluation.overall_passed ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {att.evaluation.overall_passed ? 'Passed Gate' : 'Triggered Retry'}
                        </span>
                      </div>
                      {att.delta_explanation && (
                        <div className="mt-1.5 p-1.5 bg-indigo-50/60 rounded text-[11px] text-indigo-900 border border-indigo-100">
                          {att.delta_explanation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
