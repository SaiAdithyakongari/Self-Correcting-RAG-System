import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle2, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { ClientRAGEngine } from '../utils/ragEngine';
import { StorageClient } from '../utils/storageClient';

interface UploadSectionProps {
  ragEngine: ClientRAGEngine;
  onBatchCompleted: (batchInfo: {
    batch_name: string;
    file_count: number;
    chunk_count: number;
    status: 'success' | 'amber';
    summary: string;
    failures?: string[];
    quality_rollup?: string;
    quality_issues_count?: number;
  }) => void;
}

export const UploadSection: React.FC<UploadSectionProps> = ({
  ragEngine,
  onBatchCompleted,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentFileName: '', percent: 0 });
  const [lastBatchAlert, setLastBatchAlert] = useState<{
    successCount: number;
    failCount: number;
    totalChunks: number;
    failures: string[];
    qualityTotalIssues: number;
    qualityCriticalCount: number;
    qualityMinorCount: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setIsProcessing(true);
    setLastBatchAlert(null);

    const total = fileList.length;
    let successfulDocs = 0;
    let failedDocs = 0;
    let totalNewChunks = 0;
    let batchQualityIssues = 0;
    let batchCriticalIssues = 0;
    let batchMinorIssues = 0;
    const failures: string[] = [];

    const startTime = Date.now();

    for (let i = 0; i < total; i++) {
      const file = fileList[i];
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = i > 0 ? elapsed / i : 0.05;
      const remainingSeconds = Math.max(0, Math.round((total - i) * rate));

      setProgress({
        current: i + 1,
        total,
        currentFileName: file.name,
        percent: Math.round(((i + 1) / total) * 100),
      });

      try {
        const arrayBuffer = await file.arrayBuffer();
        const res = ragEngine.addDocument(file.name, arrayBuffer);

        if (res.success) {
          successfulDocs++;
          totalNewChunks += res.chunksAdded;

          // Persist to SQLite backend non-blockingly
          if (res.doc) {
            StorageClient.saveDocument(res.doc).catch((err) =>
              console.warn('[StorageClient] saveDocument notice:', err)
            );
          }
          if (res.chunks && res.chunks.length > 0) {
            StorageClient.saveChunks(res.chunks).catch((err) =>
              console.warn('[StorageClient] saveChunks notice:', err)
            );
          }
        } else {
          failedDocs++;
          failures.push(`${file.name}: ${res.error || res.note || 'Could not parse'}`);
        }

        if (res.qualityReport) {
          batchQualityIssues += res.qualityReport.total_issues;
          batchCriticalIssues += res.qualityReport.critical_issues;
          batchMinorIssues += res.qualityReport.minor_issues;
        }
      } catch (err: any) {
        failedDocs++;
        failures.push(`${file.name}: ${err?.message || 'Read error'}`);
      }

      // Small async yield to allow UI repaint for large batch responsiveness
      if (total > 10 && i % 5 === 0) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    setIsProcessing(false);

    // Record batch in unified history with Data Quality rollup
    const statusType: 'success' | 'amber' = (failedDocs === 0 && batchCriticalIssues === 0) ? 'success' : 'amber';
    const qualityRollup =
      batchQualityIssues === 0
        ? 'All documents passed Data Quality cleanly (0 gaps or nulls).'
        : `Data Quality: ${batchQualityIssues} issue(s) detected across batch (${batchCriticalIssues} critical, ${batchMinorIssues} minor).`;

    const batchSummary = `Indexed ${successfulDocs} file(s) into ${totalNewChunks} semantic chunks. ${qualityRollup}${
      failedDocs > 0 ? ` ${failedDocs} file(s) failed or had unextractable text.` : ''
    }`;

    onBatchCompleted({
      batch_name: `Batch: ${fileList[0].name}${total > 1 ? ` (+${total - 1} more)` : ''}`,
      file_count: successfulDocs,
      chunk_count: totalNewChunks,
      status: statusType,
      summary: batchSummary,
      failures: failures.length > 0 ? failures : undefined,
      quality_rollup: qualityRollup,
      quality_issues_count: batchQualityIssues,
    });

    // Reset the active file input so user can immediately upload the next batch
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Brief temporary toast/banner that fades out quickly to prevent clutter
    setLastBatchAlert({
      successCount: successfulDocs,
      failCount: failedDocs,
      totalChunks: totalNewChunks,
      failures,
      qualityTotalIssues: batchQualityIssues,
      qualityCriticalCount: batchCriticalIssues,
      qualityMinorCount: batchMinorIssues,
    });

    setTimeout(() => {
      setLastBatchAlert(null);
    }, 6000);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">1. Ingest Documents</h2>
            <p className="text-xs text-slate-500">Supports up to 1000 files per batch</p>
          </div>
        </div>
        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
          Non-blocking
        </span>
      </div>

      <p className="text-xs text-slate-600 mb-3">
        Accepts PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, JSON, HTML, XML, RTF, EPUB, ODT, code files, and
        raw binary (with automatic printable extraction fallback).
      </p>

      {/* Upload Drop Zone / Input */}
      <div className="relative border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/20 rounded-xl p-6 text-center transition-all cursor-pointer group mb-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={isProcessing}
          onChange={handleFilesSelected}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          title="Choose files to upload"
        />
        <div className="flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-indigo-600 transition-colors mb-2" />
          <p className="text-xs font-semibold text-slate-700 group-hover:text-indigo-600">
            Click or drag & drop files here
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Multi-file batches supported</p>
        </div>
      </div>

      {/* Live Ingestion Progress */}
      {isProcessing && (
        <div className="bg-indigo-50/60 border border-indigo-200 rounded-lg p-3 text-xs mb-3 animate-fadeIn">
          <div className="flex items-center justify-between text-indigo-900 font-medium mb-1.5">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
              Indexing {progress.current} / {progress.total} documents...
            </span>
            <span className="text-indigo-700 font-bold">{progress.percent}%</span>
          </div>
          <div className="w-full bg-indigo-200 h-1.5 rounded-full overflow-hidden mb-1.5">
            <div
              className="bg-indigo-600 h-full rounded-full transition-all duration-150"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            Current: <span className="font-mono text-slate-700">{progress.currentFileName}</span>
          </p>
        </div>
      )}

      {/* Temporary Batch Notification (Fades out automatically) */}
      {lastBatchAlert && (
        <div
          className={`p-3 rounded-lg border text-xs mb-2 transition-all ${
            lastBatchAlert.failCount === 0 && lastBatchAlert.qualityCriticalCount === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-start gap-2">
            {lastBatchAlert.failCount === 0 && lastBatchAlert.qualityCriticalCount === 0 ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-semibold">
                Batch complete: {lastBatchAlert.successCount} indexed ({lastBatchAlert.totalChunks} chunks)
                {lastBatchAlert.failCount > 0 && `, ${lastBatchAlert.failCount} failed`}
              </p>

              {/* Requirement 4: Batch-level Data Quality Summary */}
              <div className="mt-1 text-[11px] flex items-center gap-1.5 font-medium">
                {lastBatchAlert.qualityTotalIssues === 0 ? (
                  <span className="text-emerald-700">✓ Data Quality: 100% clean (0 issues across batch)</span>
                ) : (
                  <span className={lastBatchAlert.qualityCriticalCount > 0 ? 'text-rose-700' : 'text-amber-800'}>
                    ⚠️ Data Quality: {lastBatchAlert.qualityTotalIssues} issue(s) detected across batch ({lastBatchAlert.qualityCriticalCount} critical, {lastBatchAlert.qualityMinorCount} minor)
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-500 mt-0.5">
                Saved to unified Session History. Panel ready for next batch.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-auto text-[11px] text-slate-400 flex items-center gap-1">
        <FileText className="w-3.5 h-3.5" />
        <span>Pre-loaded reference benchmark docs already active in memory.</span>
      </div>
    </div>
  );
};
