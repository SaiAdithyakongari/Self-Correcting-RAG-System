import React, { useState } from 'react';
import {
  FolderGit2,
  Search,
  Trash2,
  FileText,
  Database,
  Tag,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  Layers
} from 'lucide-react';
import { IndexedDocument, QualityIssue } from '../types/rag';
import { ClientRAGEngine } from '../utils/ragEngine';
import { SuggestedCorrectionsModal } from './SuggestedCorrectionsModal';

interface DocumentLibraryProps {
  documents: IndexedDocument[];
  totalChunks: number;
  onRemoveDocument: (docId: string) => void;
  ragEngine?: ClientRAGEngine;
  onUpdateCorpus?: () => void;
}

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({
  documents,
  totalChunks,
  onRemoveDocument,
  ragEngine,
  onUpdateCorpus,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [modalDoc, setModalDoc] = useState<IndexedDocument | null>(null);
  const [modalIssueId, setModalIssueId] = useState<string | null>(null);

  const filteredDocs = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const toggleExpand = (docId: string) => {
    setExpandedDocId((prev) => (prev === docId ? null : docId));
  };

  const handleOpenSuggestions = (doc: IndexedDocument, issueId?: string) => {
    setModalDoc(doc);
    setModalIssueId(issueId || null);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
            <FolderGit2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">2. Document Library</h2>
            <p className="text-xs text-slate-500">
              {documents.length} active documents ({totalChunks} semantic chunks)
            </p>
          </div>
        </div>
        <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
          <Database className="w-3 h-3 text-slate-500" />
          Dense Vector Store
        </span>
      </div>

      {/* Filter / Search Bar */}
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filter documents by filename..."
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
        />
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto max-h-[260px] space-y-2 pr-1 custom-scrollbar">
        {filteredDocs.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs">
            {documents.length === 0
              ? 'No documents currently in library. Upload files to get started.'
              : 'No documents match your search.'}
          </div>
        ) : (
          filteredDocs.map((doc) => {
            const qr = doc.quality_report;
            const status = qr?.status || 'clean';
            const totalIssues = qr?.total_issues || 0;
            const isExpanded = expandedDocId === doc.doc_id;
            const acceptedCount = doc.accepted_corrections?.length || 0;

            return (
              <div
                key={doc.doc_id}
                className={`rounded-lg border transition-all text-xs overflow-hidden ${
                  status === 'critical'
                    ? 'border-rose-200 bg-rose-50/20'
                    : status === 'minor'
                    ? 'border-amber-200 bg-amber-50/20'
                    : 'border-slate-100 bg-slate-50/60 hover:bg-white hover:border-slate-300'
                }`}
              >
                {/* Header Row */}
                <div className="flex items-center justify-between p-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <div
                      className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${
                        status === 'critical'
                          ? 'bg-rose-100 border-rose-200 text-rose-600'
                          : status === 'minor'
                          ? 'bg-amber-100 border-amber-200 text-amber-700'
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-slate-800 truncate max-w-[170px]" title={doc.filename}>
                          {doc.filename}
                        </p>

                        {/* Supplemental Draft Layer Active Badge (Requirement 1 & 4) */}
                        {acceptedCount > 0 && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-100 text-violet-800 border border-violet-200"
                            title="Supplemental draft layer active. Original document remains unaltered."
                          >
                            <Layers className="w-2.5 h-2.5 text-violet-600" />
                            <span>{acceptedCount} Supplemented</span>
                          </span>
                        )}

                        {/* Data Quality Badge (Requirement 4) */}
                        {status === 'critical' ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(doc.doc_id)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-200 hover:bg-rose-200 transition-colors cursor-pointer"
                            title="Click to inspect critical quality issues and suggest corrections"
                          >
                            <AlertOctagon className="w-3 h-3 text-rose-600 shrink-0" />
                            <span>{totalIssues} critical {totalIssues === 1 ? 'issue' : 'issues'}</span>
                            {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                          </button>
                        ) : status === 'minor' ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(doc.doc_id)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 transition-colors cursor-pointer"
                            title="Click to inspect data quality warnings and suggest corrections"
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>{totalIssues} {totalIssues === 1 ? 'issue' : 'issues'} found</span>
                            {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                            title="Data Quality Check: Clean (100% complete)"
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>Quality: Clean</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                        <span className="font-mono bg-slate-200/60 px-1 py-0.2 rounded text-slate-700">
                          {doc.chunk_count} chunks
                        </span>
                        <span>{(doc.total_chars / 1000).toFixed(1)}k chars</span>
                        {doc.extraction_note && (
                          <span className="text-amber-600 flex items-center gap-0.5" title={doc.extraction_note}>
                            <Tag className="w-2.5 h-2.5" /> fallback
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {totalIssues > 0 && ragEngine && (
                      <button
                        type="button"
                        onClick={() => handleOpenSuggestions(doc)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer"
                        title="Surface evidence-based suggested corrections for this document"
                      >
                        <Sparkles className="w-3 h-3 text-indigo-600" />
                        <span className="hidden sm:inline">Suggestions</span>
                      </button>
                    )}

                    {totalIssues > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(doc.doc_id)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                        title={isExpanded ? 'Collapse issues' : 'Expand quality issues'}
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveDocument(doc.doc_id)}
                      className="opacity-60 hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                      title="Remove document from index"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expandable Data Quality Inspection Panel (Requirement 2 & 4) */}
                {isExpanded && qr && qr.issues && qr.issues.length > 0 && (
                  <div className="px-3 pb-3 pt-2 border-t border-slate-200/60 bg-white/95">
                    <div className="flex items-center justify-between mb-1.5 text-[11px]">
                      <span className="font-bold text-slate-800 flex items-center gap-1">
                        <Info className="w-3.5 h-3.5 text-indigo-600" />
                        Data Quality Report ({qr.total_issues} detected)
                      </span>
                      <div className="flex items-center gap-2">
                        {ragEngine && (
                          <button
                            type="button"
                            onClick={() => handleOpenSuggestions(doc)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            Scan All Gaps for Suggestions
                          </button>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono">Checked at {qr.checked_at}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-600 mb-2 italic bg-slate-50 p-1.5 rounded border border-slate-100">
                      {qr.summary}
                    </p>

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                      {qr.issues.map((iss: QualityIssue) => {
                        const isAccepted = doc.accepted_corrections?.some(
                          (c) => c.issue_id === iss.issue_id
                        );

                        return (
                          <div
                            key={iss.issue_id}
                            className={`p-2.5 rounded-lg border text-[11px] flex flex-col gap-1.5 ${
                              isAccepted
                                ? 'bg-violet-50/60 border-violet-200'
                                : iss.severity === 'critical'
                                ? 'bg-rose-50/70 border-rose-200 text-rose-900'
                                : 'bg-amber-50/70 border-amber-200 text-amber-900'
                            }`}
                          >
                            <div className="flex items-center justify-between font-semibold">
                              <span className="truncate max-w-[200px]">{iss.location}</span>
                              <div className="flex items-center gap-1">
                                {isAccepted && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded font-bold bg-violet-200 text-violet-800">
                                    Supplemental Draft Active
                                  </span>
                                )}
                                <span
                                  className={`text-[9px] uppercase px-1 py-0.2 rounded font-bold ${
                                    iss.severity === 'critical'
                                      ? 'bg-rose-200 text-rose-800'
                                      : 'bg-amber-200 text-amber-800'
                                  }`}
                                >
                                  {iss.severity}
                                </span>
                              </div>
                            </div>
                            <p className="text-[10px] leading-relaxed text-slate-700 font-mono">
                              {iss.description}
                            </p>

                            {/* Suggest Correction Action Button per Issue (Requirement 2 & 3) */}
                            {ragEngine && (
                              <div className="pt-1 border-t border-slate-200/50 flex items-center justify-between">
                                <span className="text-[9px] text-slate-500 italic">
                                  Never modifies original file
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenSuggestions(doc, iss.issue_id)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-white text-indigo-700 hover:bg-indigo-50 border border-indigo-200 shadow-2xs transition-colors cursor-pointer"
                                >
                                  <Sparkles className="w-3 h-3 text-indigo-600" />
                                  <span>Suggest Correction</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
        <span>Removing a doc updates the vector matrix immediately</span>
        <span className="font-mono text-[10px] text-slate-500">
          Showing {filteredDocs.length} of {documents.length}
        </span>
      </div>

      {/* Suggested Corrections Review Modal */}
      {ragEngine && (
        <SuggestedCorrectionsModal
          isOpen={Boolean(modalDoc)}
          onClose={() => setModalDoc(null)}
          document={modalDoc}
          ragEngine={ragEngine}
          onCorpusUpdated={() => onUpdateCorpus?.()}
          selectedIssueId={modalIssueId}
        />
      )}
    </div>
  );
};

