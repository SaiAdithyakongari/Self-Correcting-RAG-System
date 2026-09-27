import React, { useState, useMemo } from 'react';
import {
  History,
  Download,
  UploadCloud,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Trash2,
  Calendar,
  HardDrive,
  Clock,
  Layers,
  FileText,
  AlertTriangle,
  CheckCircle2,
  X,
  ExternalLink,
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import {
  UnifiedHistoryItem,
  SessionRecord,
  StorageStats,
  HistoryItemType
} from '../types/rag';

interface SessionHistoryProps {
  currentSessionId: string;
  sessions: SessionRecord[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteEvent: (eventId: string) => void;
  onClearAll: () => void;
  historyItems: UnifiedHistoryItem[];
  allHistoryItems: UnifiedHistoryItem[];
  storageStats: StorageStats | null;
  onRefreshStorageStats: () => void;
  isBackendConnected: boolean;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  currentSessionId,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onDeleteEvent,
  onClearAll,
  historyItems,
  allHistoryItems,
  storageStats,
  onRefreshStorageStats,
  isBackendConnected,
}) => {
  // View mode: 'current' (current session) or 'all' (browse all sessions)
  const [viewScope, setViewScope] = useState<'current' | 'all'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'upload' | 'query' | 'quality_issues'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Confirm deletion dialog states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearSession, setConfirmClearSession] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Active items pool based on view scope
  const activePool = useMemo(() => {
    if (viewScope === 'current') {
      return historyItems;
    }
    // In 'all' scope, if a specific session is picked, filter to that, else all
    if (activeSessionId && activeSessionId !== 'all') {
      return allHistoryItems.filter((i) => i.session_id === activeSessionId);
    }
    return allHistoryItems;
  }, [viewScope, historyItems, allHistoryItems, activeSessionId]);

  // Apply Search, Filter, and Date Range
  const filteredItems = useMemo(() => {
    return activePool.filter((item) => {
      // Type filter
      if (selectedTypeFilter === 'upload' && item.type !== 'upload') return false;
      if (selectedTypeFilter === 'query' && item.type !== 'query') return false;
      if (selectedTypeFilter === 'quality_issues') {
        const hasQualityIssues =
          (item.quality_issues_count && item.quality_issues_count > 0) ||
          (item.result?.cited_chunks &&
            item.result.cited_chunks.some((c) => c.quality_alert || (c.quality_status && c.quality_status !== 'clean')));
        if (!hasQualityIssues) return false;
      }

      // Keyword search (query text, final answer, document names, summary, quality rollup)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchQ = item.question?.toLowerCase().includes(q);
        const matchA = item.answer?.toLowerCase().includes(q);
        const matchBatch = item.batch_name?.toLowerCase().includes(q);
        const matchSummary = item.summary?.toLowerCase().includes(q);
        const matchSources = item.sources?.some((s) => s.toLowerCase().includes(q));
        const matchRollup = item.quality_rollup?.toLowerCase().includes(q);
        const matchCited = item.result?.cited_chunks?.some(
          (c) => c.filename.toLowerCase().includes(q) || c.text.toLowerCase().includes(q)
        );

        if (!matchQ && !matchA && !matchBatch && !matchSummary && !matchSources && !matchRollup && !matchCited) {
          return false;
        }
      }

      // Date Range filter (using ISO or parseable timestamp)
      if (startDate) {
        const itemDate = new Date(item.timestamp).getTime();
        const filterStart = new Date(startDate).getTime();
        if (!isNaN(itemDate) && !isNaN(filterStart) && itemDate < filterStart) {
          return false;
        }
      }
      if (endDate) {
        const itemDate = new Date(item.timestamp).getTime();
        const filterEnd = new Date(endDate).getTime() + 86400000; // inclusive end of day
        if (!isNaN(itemDate) && !isNaN(filterEnd) && itemDate > filterEnd) {
          return false;
        }
      }

      return true;
    });
  }, [activePool, selectedTypeFilter, searchQuery, startDate, endDate]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Export handlers
  const handleExportJSON = () => {
    const dataStr = JSON.stringify(filteredItems, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rag_history_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const headers = [
      'Event ID',
      'Session ID',
      'Event Type',
      'Timestamp',
      'Status',
      'Title / Question',
      'Summary / Answer',
      'Cycles',
      'Groundedness',
      'Relevance',
      'Sources / Quality Rollup',
    ];

    const rows = filteredItems.map((item) => [
      `"${item.id}"`,
      `"${item.session_id || ''}"`,
      `"${item.type}"`,
      `"${item.timestamp}"`,
      `"${item.status}"`,
      `"${((item.type === 'upload' ? item.batch_name : item.question) || '').replace(/"/g, '""')}"`,
      `"${((item.type === 'upload' ? item.summary : item.answer) || '').replace(/"/g, '""')}"`,
      item.cycles_used ?? '',
      item.groundedness ? (item.groundedness * 100).toFixed(0) + '%' : '',
      item.relevance ? (item.relevance * 100).toFixed(0) + '%' : '',
      `"${(item.type === 'upload' ? item.quality_rollup || '' : (item.sources || []).join(', ')).replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rag_history_export_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
            <History className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900">
                5. Unified Session & Persistent History Storage
              </h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {filteredItems.length} Displayed / {allHistoryItems.length} Total Stored
              </span>
              {isBackendConnected && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  SQLite Persistent Engine Active
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Permanent SQLite archive: past uploads, questions, evaluation scores, source citations, and quality audits survive app restarts
            </p>
          </div>
        </div>

        {/* Action Controls: Export & Storage Footprint */}
        <div className="flex flex-wrap items-center gap-2">
          {storageStats && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg"
              title={`Database location: ${storageStats.db_path}`}
            >
              <HardDrive className="w-3.5 h-3.5 text-indigo-600" />
              <span>
                Storage Used: <strong>{storageStats.db_size_formatted}</strong>
              </span>
              <button
                onClick={onRefreshStorageStats}
                className="text-slate-400 hover:text-slate-600 p-0.5 ml-0.5 cursor-pointer"
                title="Refresh disk footprint stats"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={handleExportJSON}
              disabled={filteredItems.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-2xs transition-all cursor-pointer"
              title="Export filtered history records as JSON"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>JSON</span>
            </button>
            <button
              onClick={handleExportCSV}
              disabled={filteredItems.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-2xs transition-all cursor-pointer"
              title="Export filtered history records as CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>CSV</span>
            </button>
          </div>

          <button
            onClick={() => setConfirmClearAll(true)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50/60 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
            title="Clear all stored history"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear All</span>
          </button>
        </div>
      </div>

      {/* Navigation Controls: Active vs Past Sessions & Filter Deck */}
      <div className="bg-slate-50/70 border border-slate-200 rounded-lg p-3 mb-4 space-y-3">
        {/* Row 1: View Scope Tabs & Session Picker */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-1 bg-white border border-slate-200 p-0.5 rounded-lg shadow-2xs w-fit">
            <button
              onClick={() => setViewScope('current')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                viewScope === 'current'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Current Session ({historyItems.length})</span>
            </button>
            <button
              onClick={() => setViewScope('all')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                viewScope === 'all'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>View All History / Browse Past Sessions ({allHistoryItems.length})</span>
            </button>
          </div>

          {/* Past Session Dropdown Picker (shown especially in 'all' view) */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">Session Filter:</span>
            <select
              value={activeSessionId}
              onChange={(e) => onSelectSession(e.target.value)}
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-md px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none cursor-pointer max-w-[260px] truncate"
            >
              <option value="all">All Sessions Combined ({allHistoryItems.length} events)</option>
              {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id === currentSessionId ? '🟢 [Active] ' : '📂 '}
                  {s.name} ({s.event_count || 0})
                </option>
              ))}
            </select>

            {activeSessionId !== 'all' && activeSessionId !== currentSessionId && (
              <button
                onClick={() => setConfirmClearSession(activeSessionId)}
                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded border border-rose-200 transition-colors cursor-pointer"
                title="Delete this past session and its events"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Search, Type Filter & Date Range */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 border-t border-slate-200/60">
          {/* Keyword Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search past Q&As, topics, sources..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-white border border-slate-300 rounded-md text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Event Type Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value as any)}
              className="w-full bg-white border border-slate-300 rounded-md text-xs text-slate-800 px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none cursor-pointer"
            >
              <option value="all">All Event Types</option>
              <option value="query">Questions & Answers Only</option>
              <option value="upload">Document Uploads Only</option>
              <option value="quality_issues">Flagged Data Quality Issues Only ⚠️</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400 whitespace-nowrap">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-md text-xs text-slate-800 px-1.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none cursor-pointer"
            />
          </div>

          {/* End Date */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400 whitespace-nowrap">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-md text-xs text-slate-800 px-1.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none cursor-pointer"
            />
            {(startDate || endDate || searchQuery || selectedTypeFilter !== 'all') && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setSearchQuery('');
                  setSelectedTypeFilter('all');
                }}
                className="text-[10px] text-slate-500 hover:text-slate-800 underline shrink-0 px-1 cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modals / Banners */}
      {confirmClearAll && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-300 rounded-lg flex items-center justify-between gap-3 text-xs animate-fadeIn">
          <div className="flex items-center gap-2 text-rose-800">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>
              <strong>Confirm Permanent Purge:</strong> Are you sure you want to permanently erase all past history records across all sessions? This cannot be undone.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                onClearAll();
                setConfirmClearAll(false);
              }}
              className="px-2.5 py-1 bg-rose-600 text-white font-semibold rounded hover:bg-rose-700 cursor-pointer"
            >
              Yes, Delete Everything
            </button>
            <button
              onClick={() => setConfirmClearAll(false)}
              className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmClearSession && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between gap-3 text-xs animate-fadeIn">
          <div className="flex items-center gap-2 text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              <strong>Delete Session:</strong> Are you sure you want to delete this past session and its recorded events?
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                onDeleteSession(confirmClearSession);
                setConfirmClearSession(null);
              }}
              className="px-2.5 py-1 bg-amber-600 text-white font-semibold rounded hover:bg-amber-700 cursor-pointer"
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setConfirmClearSession(null)}
              className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Events Timeline Feed */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg">
          <p className="font-semibold text-slate-500 mb-1">No matching history events found</p>
          <p>
            {activePool.length === 0
              ? 'Upload a document or submit a question to start recording persistent session history.'
              : 'Try adjusting your search keywords, event filters, or date range.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
          {filteredItems.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            const isUpload = item.type === 'upload';
            const isSummary = item.type === 'summary';
            const isQuery = item.type === 'query';
            const isSuccess = item.status === 'success';
            const isLiveCurrentSession = item.session_id === currentSessionId || !item.session_id;

            return (
              <div
                key={item.id}
                className={`rounded-lg border text-xs transition-all ${
                  isSuccess
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : 'border-amber-200 bg-amber-50/20'
                }`}
              >
                {/* Event Summary Header */}
                <div
                  onClick={() => toggleExpand(item.id)}
                  className="p-3 flex items-start justify-between cursor-pointer select-none"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div
                      className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                        isUpload
                          ? 'bg-blue-100 text-blue-700'
                          : isSummary
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      {isUpload ? (
                        <UploadCloud className="w-4 h-4" />
                      ) : isSummary ? (
                        <Sparkles className="w-4 h-4" />
                      ) : (
                        <MessageSquare className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-bold text-slate-900 truncate">
                          {isUpload
                            ? item.batch_name
                            : isSummary
                            ? 'On-Demand Document Corpus Summarization'
                            : `"${item.question}"`}
                        </span>

                        {/* Status Badge */}
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            isSuccess
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isSuccess ? 'SUCCESS' : 'PARTIAL / LOW CONF'}
                        </span>

                        {/* Active Session vs Past Session Indicator */}
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.2 rounded-md ${
                            isLiveCurrentSession
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isLiveCurrentSession ? '🟢 Active Session' : '📂 Past Session'}
                        </span>

                        {/* Timestamp */}
                        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-300" />
                          {item.timestamp}
                        </span>
                      </div>

                      {/* Quick metrics row */}
                      <div className="text-[11px] text-slate-600 flex items-center gap-3 flex-wrap">
                        {isUpload ? (
                          <>
                            <span>{item.file_count} files indexed</span>
                            <span>{item.chunk_count} chunks</span>
                            {item.quality_issues_count !== undefined && item.quality_issues_count > 0 ? (
                              <span className="text-amber-700 font-medium flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                                {item.quality_issues_count} quality issue(s) flagged
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-medium flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                100% Clean Ingestion
                              </span>
                            )}
                          </>
                        ) : isSummary ? (
                          <>
                            <span>Corpus Synthesis Generated</span>
                            <span>3 Suggested Test Queries Ready</span>
                          </>
                        ) : (
                          <>
                            <span>{item.cycles_used} retrieval cycle(s)</span>
                            <span>
                              Groundedness: <strong>{Math.round((item.groundedness || 0) * 100)}%</strong>
                            </span>
                            <span>
                              Relevance: <strong>{Math.round((item.relevance || 0) * 100)}%</strong>
                            </span>
                            {item.honesty_gate_triggered && (
                              <span className="text-indigo-600 font-semibold">
                                🛡️ Honesty Gate Activated
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {/* Delete Individual Event Button with Confirm */}
                    {confirmDeleteId === item.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 bg-white p-1 rounded border border-rose-200 shadow-2xs"
                      >
                        <span className="text-[10px] text-rose-600 font-semibold">Delete?</span>
                        <button
                          onClick={() => {
                            onDeleteEvent(item.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-1.5 py-0.5 bg-rose-600 text-white rounded text-[10px] hover:bg-rose-700 cursor-pointer"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] hover:bg-slate-200 cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(item.id);
                        }}
                        className="text-slate-300 hover:text-rose-500 p-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                        title="Delete this history record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <div className="text-slate-400 hover:text-slate-600 p-1">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expandable Full Detail Body (Reconstructs what happened with exact chunks, scores, retry attempts) */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-2 border-t border-slate-200/60 mt-1 space-y-3 animate-fadeIn">
                    {isUpload && (
                      <div className="space-y-2">
                        <p className="text-slate-700">{item.summary}</p>
                        {item.quality_rollup && (
                          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-slate-800 text-[11px]">
                            <span className="font-semibold text-slate-900">Data Quality Audit: </span>
                            {item.quality_rollup}
                          </div>
                        )}
                        {item.failures && item.failures.length > 0 && (
                          <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-[11px]">
                            <strong>Partial Failures / Non-blocking Extraction Notes:</strong>
                            <ul className="list-disc list-inside mt-0.5">
                              {item.failures.map((f, fi) => (
                                <li key={fi}>{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {isSummary && item.corpus_summary_report && (
                      <div className="space-y-2">
                        <div className="p-2.5 bg-white rounded border border-purple-200">
                          <p className="font-semibold text-purple-900 mb-1">Corpus Synthesis:</p>
                          <p className="text-slate-700 leading-relaxed">
                            {item.corpus_summary_report.corpus_summary}
                          </p>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          <strong>Suggested Inquiries:</strong>
                          <ul className="list-disc list-inside mt-1 text-slate-700 space-y-0.5">
                            {item.corpus_summary_report.suggested_questions.map((q, qi) => (
                              <li key={qi}>{q}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    {isQuery && (
                      <div className="space-y-3">
                        {/* Final Answer */}
                        <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                          <p className="font-semibold text-slate-800 mb-1 flex items-center justify-between">
                            <span>Synthesized Answer:</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              Evaluated across {item.cycles_used} cycle(s)
                            </span>
                          </p>
                          <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                            {item.answer}
                          </p>
                        </div>

                        {/* Detailed Score Breakdown */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                          <div className="p-2 bg-slate-50 border border-slate-200 rounded-md">
                            <span className="text-slate-500 block text-[10px]">Groundedness</span>
                            <span className="font-bold text-slate-800">
                              {Math.round((item.groundedness || 0) * 100)}%
                            </span>
                          </div>
                          <div className="p-2 bg-slate-50 border border-slate-200 rounded-md">
                            <span className="text-slate-500 block text-[10px]">Relevance</span>
                            <span className="font-bold text-slate-800">
                              {Math.round((item.relevance || 0) * 100)}%
                            </span>
                          </div>
                          <div className="p-2 bg-slate-50 border border-slate-200 rounded-md">
                            <span className="text-slate-500 block text-[10px]">Retrieval Cycles</span>
                            <span className="font-bold text-slate-800">{item.cycles_used}</span>
                          </div>
                          <div className="p-2 bg-slate-50 border border-slate-200 rounded-md">
                            <span className="text-slate-500 block text-[10px]">Honesty Gate</span>
                            <span
                              className={`font-bold ${
                                item.honesty_gate_triggered ? 'text-indigo-600' : 'text-slate-600'
                              }`}
                            >
                              {item.honesty_gate_triggered ? 'TRIGGERED' : 'PASSED'}
                            </span>
                          </div>
                        </div>

                        {/* Exact Cited Sources & Traceability with Quality Alerts */}
                        {item.result?.cited_chunks && item.result.cited_chunks.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-semibold text-slate-800 text-[11px]">
                              Retrieved Context Chunks ({item.result.cited_chunks.length}):
                            </span>
                            <div className="space-y-1.5">
                              {item.result.cited_chunks.map((chk, ci) => (
                                <div
                                  key={ci}
                                  className="p-2 bg-white rounded border border-slate-200 text-[11px]"
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="font-semibold text-indigo-700">
                                      [Source {chk.rank}] {chk.filename} (Chunk #{chk.chunk_index})
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      Sim: {chk.similarity_score}
                                    </span>
                                  </div>
                                  {chk.quality_alert && (
                                    <div className="mb-1 text-amber-800 font-medium bg-amber-50 p-1.5 rounded border border-amber-200 text-[10px]">
                                      ⚠️ {chk.quality_alert}
                                    </div>
                                  )}
                                  <p className="text-slate-600 font-mono text-[10px] line-clamp-3 bg-slate-50 p-1.5 rounded border border-slate-100">
                                    {chk.text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Claims Analysis breakdown if present */}
                        {item.result?.claims_analysis && item.result.claims_analysis.length > 0 && (
                          <div className="p-2 bg-slate-50 rounded border border-slate-200 text-[11px]">
                            <span className="font-semibold text-slate-900 block mb-1">
                              Fact & Claims Verification Breakdown:
                            </span>
                            <div className="space-y-1">
                              {item.result.claims_analysis.map((cl, cli) => (
                                <div key={cli} className="flex items-start gap-1.5 text-[10px]">
                                  <span
                                    className={`px-1 py-0.2 rounded font-bold shrink-0 ${
                                      cl.status === 'SUPPORTED'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {cl.status}
                                  </span>
                                  <span className="text-slate-700">"{cl.text}"</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Retry Cycle Delta Summary */}
                        {item.result?.attempts && item.result.attempts.length > 1 && (
                          <div className="p-2 bg-indigo-50/60 rounded border border-indigo-100 text-[10px] text-indigo-900">
                            <strong>Multi-Cycle Correction Progression:</strong>
                            <div className="space-y-1 mt-1">
                              {item.result.attempts.map((att, ai) => (
                                <div key={ai} className="flex justify-between items-center">
                                  <span>
                                    Cycle {att.cycle_number}: {att.strategy_description} (k={att.k_used})
                                  </span>
                                  <span className="font-semibold">
                                    G: {Math.round(att.evaluation.groundedness_score * 100)}% | R: {Math.round(att.evaluation.relevance_score * 100)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
