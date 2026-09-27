import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { UploadSection } from './components/UploadSection';
import { DocumentLibrary } from './components/DocumentLibrary';
import { SummarizerSection } from './components/SummarizerSection';
import { QueryPipelineSection } from './components/QueryPipelineSection';
import { SessionHistory } from './components/SessionHistory';
import { WalkthroughModal } from './components/WalkthroughModal';
import { FileEditorSection } from './components/FileEditorSection';
import { ClientRAGEngine } from './utils/ragEngine';
import { StorageClient } from './utils/storageClient';
import {
  UnifiedHistoryItem,
  CorpusSummaryReport,
  PipelineResult,
  IndexedDocument,
  SessionRecord,
  StorageStats
} from './types/rag';
import { Shield, Sparkles, Sliders, Database, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function App() {
  // Initialize RAG Engine
  const ragEngine = useMemo(() => new ClientRAGEngine(), []);

  // Stable session ID for the current app execution session
  const [currentSessionId] = useState<string>(() => {
    const existing = sessionStorage.getItem('rag_active_session_id');
    if (existing) return existing;
    const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    sessionStorage.setItem('rag_active_session_id', newId);
    return newId;
  });

  // Application state
  const [documents, setDocuments] = useState<IndexedDocument[]>(() =>
    ragEngine.getDocumentList()
  );
  const [totalChunks, setTotalChunks] = useState<number>(() =>
    ragEngine.getTotalChunks()
  );

  // Sessions and persistent history lists
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSessionFilter, setActiveSessionFilter] = useState<string>('all');
  const [currentSessionHistory, setCurrentSessionHistory] = useState<UnifiedHistoryItem[]>([]);
  const [allHistoryItems, setAllHistoryItems] = useState<UnifiedHistoryItem[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(true);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const [activeSummary, setActiveSummary] = useState<CorpusSummaryReport | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<string>('');
  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState<boolean>(false);
  const [activeAppTab, setActiveAppTab] = useState<'rag' | 'file-editor'>('rag');

  // Threshold configurations
  const [groundednessThreshold, setGroundednessThreshold] = useState<number>(0.70);
  const [relevanceThreshold, setRelevanceThreshold] = useState<number>(0.70);
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [showConfig, setShowConfig] = useState<boolean>(false);

  // Sync document state after mutations
  const refreshDocState = useCallback(() => {
    setDocuments(ragEngine.getDocumentList());
    setTotalChunks(ragEngine.getTotalChunks());
  }, [ragEngine]);

  // Load storage footprint and sessions list
  const refreshStorageData = useCallback(async () => {
    try {
      const stats = await StorageClient.getStorageStats();
      if (stats) {
        setStorageStats(stats);
        setIsBackendConnected(true);
      }
      const sessList = await StorageClient.listSessions();
      setSessions(sessList);

      const allEvents = await StorageClient.getEvents();
      setAllHistoryItems(allEvents);

      // Filter for current session
      const currentEvents = allEvents.filter((e) => e.session_id === currentSessionId);
      setCurrentSessionHistory(currentEvents);
    } catch (err: any) {
      console.warn('[App] Failed refreshing storage data:', err);
    }
  }, [currentSessionId]);

  // Initial load: ensure session, hydrate documents and history from SQLite
  useEffect(() => {
    let mounted = true;

    async function initializePersistence() {
      try {
        const displayTime = new Date().toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const sessionName = `Session — ${displayTime}`;

        // Ensure session in backend SQLite
        await StorageClient.ensureSession(currentSessionId, sessionName);

        // Check if there are existing documents in SQLite
        const persistedDocs = await StorageClient.loadDocuments();
        const persistedChunks = await StorageClient.loadChunks();

        if (mounted && persistedDocs && persistedDocs.length > 0) {
          // Hydrate ClientRAGEngine with persisted documents and chunks
          ragEngine.loadPersistedCorpus(persistedDocs, persistedChunks);
          refreshDocState();
        } else {
          // If fresh database, persist default seeded corpus to SQLite so it survives restarts
          const defaultDocs = ragEngine.getDocumentList();
          for (const d of defaultDocs) {
            await StorageClient.saveDocument(d);
          }
          // Seed initial upload history event if empty
          const initEvent: UnifiedHistoryItem = {
            id: `init_${Date.now()}`,
            session_id: currentSessionId,
            type: 'upload',
            timestamp: new Date().toLocaleTimeString(),
            status: 'success',
            batch_name: 'Pre-loaded Benchmark Corpus (4 Files)',
            file_count: 4,
            chunk_count: ragEngine.getTotalChunks(),
            summary:
              'Initialized knowledge base with 4 multi-domain benchmark files covering Cloud Zero-Trust Architecture, AI Governance Protocols, Financial Operating Metrics, and Quantum Computing.',
            quality_rollup: 'All 4 documents verified clean (0 nulls or structural gaps).',
            quality_issues_count: 0,
          };
          await StorageClient.saveEvent(initEvent, currentSessionId);
        }

        if (mounted) {
          await refreshStorageData();
        }
      } catch (err: any) {
        console.warn('[App] Persistence initialization warning:', err);
        if (mounted) {
          setStorageWarning('Persistent history database connection is running in local fallback mode.');
        }
      }
    }

    initializePersistence();

    return () => {
      mounted = false;
    };
  }, [currentSessionId, ragEngine, refreshDocState, refreshStorageData]);

  // Handler for completed upload batch
  const handleBatchCompleted = async (batchInfo: {
    batch_name: string;
    file_count: number;
    chunk_count: number;
    status: 'success' | 'amber';
    summary: string;
    failures?: string[];
    quality_rollup?: string;
    quality_issues_count?: number;
  }) => {
    refreshDocState();

    const newItem: UnifiedHistoryItem = {
      id: `upload_${Date.now()}`,
      session_id: currentSessionId,
      type: 'upload',
      timestamp: new Date().toLocaleTimeString(),
      status: batchInfo.status,
      batch_name: batchInfo.batch_name,
      file_count: batchInfo.file_count,
      chunk_count: batchInfo.chunk_count,
      summary: batchInfo.summary,
      failures: batchInfo.failures,
      quality_rollup: batchInfo.quality_rollup,
      quality_issues_count: batchInfo.quality_issues_count,
    };

    // Optimistic UI update
    setCurrentSessionHistory((prev) => [newItem, ...prev]);
    setAllHistoryItems((prev) => [newItem, ...prev]);

    // Save immediately to persistent SQLite database
    try {
      await StorageClient.saveEvent(newItem, currentSessionId);
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Non-blocking warning: failed persisting upload event:', err);
      setStorageWarning('Failed to save upload event to disk — continuing session without interruption.');
    }
  };

  // Handler for document deletion
  const handleRemoveDocument = async (docId: string) => {
    ragEngine.removeDocument(docId);
    refreshDocState();

    try {
      await StorageClient.deleteDocument(docId);
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Non-blocking warning: failed removing document from disk:', err);
    }
  };

  // Handler for completed query execution
  const handleQueryCompleted = async (result: PipelineResult) => {
    const newItem: UnifiedHistoryItem = {
      id: `query_${Date.now()}`,
      session_id: currentSessionId,
      type: 'query',
      timestamp: new Date().toLocaleTimeString(),
      status: result.passed ? 'success' : 'amber',
      question: result.question,
      answer: result.final_answer,
      cycles_used: result.cycles_used,
      groundedness: result.groundedness_score,
      relevance: result.relevance_score,
      sources: result.cited_chunks.map((c) => c.filename),
      honesty_gate_triggered: result.honesty_gate_triggered,
      result,
    };

    // Optimistic UI update
    setCurrentSessionHistory((prev) => [newItem, ...prev]);
    setAllHistoryItems((prev) => [newItem, ...prev]);

    // Save immediately to persistent SQLite database
    try {
      await StorageClient.saveEvent(newItem, currentSessionId);
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Non-blocking warning: failed persisting query event:', err);
      setStorageWarning('Failed to save query event to disk — continuing session without interruption.');
    }
  };

  // Handler for completed summary generation
  const handleSummaryCompleted = async (report: CorpusSummaryReport) => {
    const newItem: UnifiedHistoryItem = {
      id: `summary_${Date.now()}`,
      session_id: currentSessionId,
      type: 'summary',
      timestamp: new Date().toLocaleTimeString(),
      status: 'success',
      summary: report.corpus_summary,
      corpus_summary_report: report,
    };

    setCurrentSessionHistory((prev) => [newItem, ...prev]);
    setAllHistoryItems((prev) => [newItem, ...prev]);

    try {
      await StorageClient.saveEvent(newItem, currentSessionId);
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Failed persisting summary event:', err);
    }
  };

  // Delete an individual history event
  const handleDeleteEvent = async (eventId: string) => {
    setCurrentSessionHistory((prev) => prev.filter((e) => e.id !== eventId));
    setAllHistoryItems((prev) => prev.filter((e) => e.id !== eventId));

    try {
      await StorageClient.deleteEvent(eventId);
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Failed deleting event:', err);
    }
  };

  // Delete an entire past session
  const handleDeleteSession = async (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    setAllHistoryItems((prev) => prev.filter((e) => e.session_id !== sessionId));
    if (activeSessionFilter === sessionId) {
      setActiveSessionFilter('all');
    }

    try {
      await StorageClient.deleteSession(sessionId);
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Failed deleting session:', err);
    }
  };

  // Clear all history events
  const handleClearAllHistory = async () => {
    setCurrentSessionHistory([]);
    setAllHistoryItems([]);
    setSessions([]);

    try {
      await StorageClient.clearAllHistory();
      await refreshStorageData();
    } catch (err: any) {
      console.warn('[App] Failed clearing history:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Navbar with live event counts, active session indicator, and walkthrough trigger */}
      <Navbar
        eventCount={allHistoryItems.length}
        docCount={documents.length}
        chunkCount={totalChunks}
        onOpenWalkthrough={() => setIsWalkthroughOpen(true)}
      />

      {/* Non-blocking Storage Warning Notice */}
      {storageWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center justify-between">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{storageWarning}</span>
            <button
              onClick={() => setStorageWarning(null)}
              className="ml-auto text-amber-600 hover:text-amber-800 font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* Operational Guardrails Banner */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-slate-800">Operational Guardrails:</span>
            <span className="text-slate-600">
              Groundedness Target: <strong>{Math.round(groundednessThreshold * 100)}%</strong> | Relevance: <strong>{Math.round(relevanceThreshold * 100)}%</strong> | Max Retries: <strong>{maxRetries}</strong>
            </span>
          </div>

          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-800 py-1 px-2 rounded hover:bg-indigo-50 transition-colors cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{showConfig ? 'Hide Thresholds' : 'Adjust Thresholds'}</span>
          </button>
        </div>

        {/* Collapsible Threshold Configuration Sliders */}
        {showConfig && (
          <div className="bg-white rounded-xl border border-indigo-100 p-4 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs animate-fadeIn">
            <div>
              <label className="font-semibold text-slate-700 flex justify-between mb-1">
                <span>Groundedness Target</span>
                <span className="text-indigo-600 font-bold">{Math.round(groundednessThreshold * 100)}%</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={groundednessThreshold}
                onChange={(e) => setGroundednessThreshold(parseFloat(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Minimum claims requiring verified citation support.
              </p>
            </div>

            <div>
              <label className="font-semibold text-slate-700 flex justify-between mb-1">
                <span>Relevance Target</span>
                <span className="text-indigo-600 font-bold">{Math.round(relevanceThreshold * 100)}%</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={relevanceThreshold}
                onChange={(e) => setRelevanceThreshold(parseFloat(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Minimum question intent alignment.
              </p>
            </div>

            <div>
              <label className="font-semibold text-slate-700 flex justify-between mb-1">
                <span>Max Retrieval Retries</span>
                <span className="text-indigo-600 font-bold">{maxRetries} cycles</span>
              </label>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={maxRetries}
                onChange={(e) => setMaxRetries(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Retries before activating Honesty Gate.
              </p>
            </div>
          </div>
        )}

        {/* Section 1 & 2: Top Row (Ingest Documents & Document Library side-by-side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UploadSection
            ragEngine={ragEngine}
            onBatchCompleted={handleBatchCompleted}
          />
          <DocumentLibrary
            documents={documents}
            totalChunks={totalChunks}
            onRemoveDocument={handleRemoveDocument}
            ragEngine={ragEngine}
            onUpdateCorpus={refreshDocState}
          />
        </div>

        {/* Section 3: Document Summarization On-Demand */}
        <SummarizerSection
          ragEngine={ragEngine}
          activeSummary={activeSummary}
          onSetSummary={setActiveSummary}
          onSelectQuestion={(q) => setSelectedQuestion(q)}
          docCount={documents.length}
          onSummaryCompleted={handleSummaryCompleted}
        />

        {/* Section 4: Question Asking with Real-Time Pipeline & Traceability */}
        <QueryPipelineSection
          ragEngine={ragEngine}
          selectedQuestion={selectedQuestion}
          onClearSelectedQuestion={() => setSelectedQuestion('')}
          onQueryCompleted={handleQueryCompleted}
          groundednessThreshold={groundednessThreshold}
          relevanceThreshold={relevanceThreshold}
          maxRetries={maxRetries}
        />

        {/* Section 5: Unified Session & Persistent History Storage */}
        <SessionHistory
          currentSessionId={currentSessionId}
          sessions={sessions}
          activeSessionId={activeSessionFilter}
          onSelectSession={setActiveSessionFilter}
          onDeleteSession={handleDeleteSession}
          onDeleteEvent={handleDeleteEvent}
          onClearAll={handleClearAllHistory}
          historyItems={currentSessionHistory}
          allHistoryItems={allHistoryItems}
          storageStats={storageStats}
          onRefreshStorageStats={refreshStorageData}
          isBackendConnected={isBackendConnected}
        />
      </main>

      {/* Non-technical Walkthrough Modal */}
      <WalkthroughModal
        isOpen={isWalkthroughOpen}
        onClose={() => setIsWalkthroughOpen(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Self-Correcting RAG System &copy; 2026. Production-Ready Closed-Loop Verification.</span>
          <span className="text-slate-400">
            Persistent SQLite Database &bull; Dense Vector Index &bull; Adaptive Query Reformulation &bull; Honesty Gate
          </span>
        </div>
      </footer>
    </div>
  );
}
