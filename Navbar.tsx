import React from 'react';
import { ShieldCheck, HelpCircle, Activity, FileCode, Database } from 'lucide-react';

interface NavbarProps {
  eventCount: number;
  docCount: number;
  chunkCount: number;
  onOpenWalkthrough: () => void;
  activeTab: 'rag' | 'file-editor';
  onSelectTab: (tab: 'rag' | 'file-editor') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  eventCount,
  docCount,
  chunkCount,
  onOpenWalkthrough,
  activeTab,
  onSelectTab,
}) => {
  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                Self-Correcting RAG System
              </h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                v1.0 Production
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">
              Closed-Loop RAG with Multi-Cycle Retrieval Retries & Honesty Gate
            </p>
          </div>
        </div>

        {/* Primary Tool Tabs (Requirement 1) */}
        <div className="hidden lg:flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
          <button
            onClick={() => onSelectTab('rag')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === 'rag'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Knowledge Base & RAG</span>
            <span className="text-[10px] font-normal opacity-70">({docCount} docs)</span>
          </button>
          <button
            onClick={() => onSelectTab('file-editor')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === 'file-editor'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-indigo-600" />
            <span>Prompt File Editor</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-bold uppercase">
              New
            </span>
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-3 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>
                <strong>{docCount}</strong> docs ({chunkCount} chunks)
              </span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-indigo-700 font-medium">
              <Activity className="w-3.5 h-3.5" />
              <span>
                <strong>{eventCount}</strong> Timeline Events
              </span>
            </div>
          </div>

          <button
            onClick={onOpenWalkthrough}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors shadow-2xs"
            title="How This Works: Non-technical guide"
          >
            <HelpCircle className="w-4 h-4 text-indigo-600" />
            <span className="hidden sm:inline">How This Works</span>
          </button>
        </div>
      </div>
    </header>
  );
};
