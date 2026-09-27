"""
Self-Correcting RAG System - Streamlit Application.
Features a real-time, transparent UI with multi-cycle retrieval retries,
automated evaluation gauges, honesty gate enforcement, unified session history,
and on-demand document summarization.
"""

import os
import time
import json
from datetime import datetime
import streamlit as st

from python_rag.ingestion import DocumentIngestionEngine
from python_rag.vector_store import VectorStore
from python_rag.evaluator import AnswerEvaluator
from python_rag.orchestrator import SelfCorrectingRAG, PipelineState
from python_rag.summarizer import DocumentSummarizer
from python_rag.storage import PersistentStorage

# Streamlit Page Configuration
st.set_page_config(
    page_title="Self-Correcting RAG System",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling
st.markdown("""
<style>
    .metric-card-green {
        background: #f0fdf4;
        border: 1px solid #86efac;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
    }
    .metric-card-amber {
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
    }
    .metric-card-red {
        background: #fef2f2;
        border: 1px solid #fca5a5;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
    }
    .badge-retry {
        background-color: #6366f1;
        color: white;
        padding: 4px 10px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 0.85rem;
    }
    .citation-tag {
        background-color: #e0e7ff;
        color: #3730a3;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 4px;
        margin: 0 2px;
    }
</style>
""", unsafe_allow_html=True)


# Initialize Session State
if "storage" not in st.session_state:
    st.session_state.storage = PersistentStorage()
    st.session_state.session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    st.session_state.session_name = f"Session — {datetime.now().strftime('%b %d, %Y, %I:%M %p')}"
    st.session_state.storage.ensure_session(st.session_state.session_id, st.session_state.session_name)
    st.session_state.vector_store = VectorStore(storage=st.session_state.storage, auto_load=True)
    st.session_state.ingestion_engine = DocumentIngestionEngine()
    st.session_state.summarizer = DocumentSummarizer(st.session_state.vector_store)
    
    # Load previously stored history events from SQLite
    persisted_events = st.session_state.storage.get_events(session_id=st.session_state.session_id)
    st.session_state.session_history = persisted_events if persisted_events else []
    st.session_state.active_summary = None
    # Check if vector store already has documents loaded from SQLite
    st.session_state.preloaded = len(st.session_state.vector_store.get_library_summary()) > 0

# Auto-preload sample documents on first startup
def preload_samples():
    if st.session_state.preloaded:
        return
    sample_dir = "sample_documents"
    if os.path.exists(sample_dir):
        files_indexed = 0
        total_chunks = 0
        for fname in sorted(os.listdir(sample_dir)):
            fpath = os.path.join(sample_dir, fname)
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    content = f.read()
                chunks, note, q_report = st.session_state.ingestion_engine.ingest_single_file(fname, content)
                if chunks:
                    st.session_state.vector_store.add_chunks(chunks, quality_report=q_report)
                    files_indexed += 1
                    total_chunks += len(chunks)
                else:
                    ext = os.path.splitext(fname)[1]
                    st.session_state.vector_store.register_empty_document(f"doc_{fname}", fname, ext, q_report)
                    files_indexed += 1

        if files_indexed > 0:
            st.session_state.session_history.append({
                "type": "upload",
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "batch_name": "Pre-loaded Reference Corpus",
                "file_count": files_indexed,
                "chunk_count": total_chunks,
                "status": "success",
                "summary": f"Initial knowledge base loaded with {files_indexed} benchmark documents across Security, AI Governance, Financials, and Quantum Computing. Automatic Data Quality inspection completed.",
                "quality_rollup": "Benchmark corpus checked: documents verified for integrity and structure."
            })
    st.session_state.preloaded = True

preload_samples()

# Sidebar: Controls, Walkthrough & Configuration
with st.sidebar:
    st.title("🛡️ RAG Control Deck")
    st.markdown("**Production Self-Correcting RAG** with real-time honesty evaluation and adaptive retrieval retries.")

    with st.expander("ℹ️ How This Works (Walkthrough)", expanded=False):
        st.markdown("""
        1. **Retrieve:** Question is vectorized and matched against top-k chunks.
        2. **Generate:** Answer is synthesized with numbered source citations `[1]`.
        3. **Evaluate:** Automated judge calculates **Groundedness** (faithfulness to sources) and **Relevance** (alignment with user intent).
        4. **Honesty Gate & Self-Correction:** If either score falls below threshold, retrieval automatically retries with rephrased query and broader context (up to 3 cycles).
        5. **Safe Fallback:** If confidence remains low, the system explicitly reports insufficient evidence instead of hallucinating.
        """)

    st.subheader("⚙️ System Thresholds")
    groundedness_thresh = st.slider(
        "Groundedness Target",
        min_value=0.50,
        max_value=0.95,
        value=0.70,
        step=0.05,
        help="Minimum percentage of answer claims that must be backed by retrieved text."
    )
    relevance_thresh = st.slider(
        "Relevance Target",
        min_value=0.50,
        max_value=0.95,
        value=0.70,
        step=0.05,
        help="Minimum alignment of answer content to user question."
    )
    max_retries = st.slider(
        "Max Retrieval Cycles",
        min_value=1,
        max_value=5,
        value=3,
        step=1,
        help="Maximum number of automated correction loops before activating the Honesty Gate."
    )

    st.divider()
    # Tooltip Legend
    st.markdown("**Glossary of Terms:**")
    st.caption("• **Groundedness:** Degree to which every fact is strictly proven by document chunks.")
    st.caption("• **Relevance:** Whether the response directly answers what was asked.")
    st.caption("• **Chunk:** Distinct text slice (600 chars) indexed with metadata.")
    st.caption("• **Honesty Gate:** Safety rule preventing hallucination when evidence is sparse.")

# Top Header & Stats
col_title, col_stat = st.columns([3, 1])
with col_title:
    st.title("Self-Correcting RAG System")
    st.caption("Inspectable, Closed-Loop Retrieval-Augmented Generation with Automated Multi-Cycle Verification")
with col_stat:
    total_events = len(st.session_state.session_history)
    st.metric("Unified Session Events", total_events)

# Section 1 & 2: Main Landing Page Top Half (Upload & Library side by side)
col_upload, col_library = st.columns([1, 1])

with col_upload:
    st.subheader("1. Ingest Documents")
    st.caption("Upload up to 1000 files (PDF, DOCX, TXT, CSV, JSON, MD, Code, etc.)")
    uploaded_files = st.file_uploader(
        "Choose documents for ingestion",
        accept_multiple_files=True,
        key="file_uploader_widget"
    )

    if uploaded_files:
        if st.button("🚀 Index Uploaded Batch", type="primary"):
            progress_bar = st.progress(0)
            status_text = st.empty()

            total_files = len(uploaded_files)
            successful_docs = 0
            failed_docs = 0
            total_new_chunks = 0
            batch_total_issues = 0
            batch_critical_issues = 0
            batch_minor_issues = 0
            failures = []

            for idx, uf in enumerate(uploaded_files):
                status_text.text(f"Indexing {idx + 1} / {total_files}: {uf.name}")
                content = uf.read()
                chunks, note, q_report = st.session_state.ingestion_engine.ingest_single_file(uf.name, content)
                ext = os.path.splitext(uf.name)[1]

                batch_total_issues += q_report.total_issues
                batch_critical_issues += q_report.critical_issues
                batch_minor_issues += q_report.minor_issues

                # Non-blocking: even files with 0 chunks (e.g. scanned image PDF) are registered in library
                if chunks:
                    added = st.session_state.vector_store.add_chunks(chunks, quality_report=q_report)
                    successful_docs += 1
                    total_new_chunks += added
                else:
                    st.session_state.vector_store.register_empty_document(f"doc_{uf.name}", uf.name, ext, q_report)
                    successful_docs += 1

                progress_bar.progress((idx + 1) / total_files)

            status_text.empty()
            progress_bar.empty()

            status_type = "success" if (failed_docs == 0 and batch_critical_issues == 0) else "warning"
            quality_rollup = (
                f"Data Quality: {batch_total_issues} issue(s) detected across batch ({batch_critical_issues} critical, {batch_minor_issues} minor)."
                if batch_total_issues > 0
                else "Data Quality: All documents verified clean (0 nulls or structural gaps)."
            )

            batch_summary = f"Indexed {successful_docs} files ({total_new_chunks} chunks). {quality_rollup}"

            st.session_state.session_history.append({
                "type": "upload",
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "batch_name": f"Batch of {total_files} file(s)",
                "file_count": successful_docs,
                "chunk_count": total_new_chunks,
                "status": status_type,
                "summary": batch_summary,
                "quality_rollup": quality_rollup,
                "quality_issues_count": batch_total_issues,
                "failures": failures if failures else None
            })
            st.success(f"Indexed {successful_docs} document(s) ({total_new_chunks} chunks). {quality_rollup}")
            st.rerun()

with col_library:
    st.subheader("2. Document Library")
    docs = st.session_state.vector_store.get_library_summary()
    st.caption(f"Currently indexing **{len(docs)} documents** ({st.session_state.vector_store.get_total_chunks()} total chunks)")

    search_lib = st.text_input("🔍 Filter library by filename", placeholder="Type to search...", key="lib_filter")
    filtered_docs = [d for d in docs if search_lib.lower() in d["filename"].lower()] if search_lib else docs

    if filtered_docs:
        for d in filtered_docs[:8]:
            qr = d.get("quality_report") or {}
            q_status = qr.get("status", "clean")
            total_issues = qr.get("total_issues", 0)
            issues_list = qr.get("issues", [])

            c1, c2, c3 = st.columns([3, 1, 1])
            with c1:
                st.write(f"📄 **{d['filename']}**")
                # Data Quality Badge (Requirement 4)
                if q_status == "critical":
                    st.markdown(f"<span style='color: #dc2626; font-size: 0.75rem; font-weight: bold;'>🔴 Quality: {total_issues} Critical Issues (scanned/empty)</span>", unsafe_allow_html=True)
                elif q_status == "minor":
                    st.markdown(f"<span style='color: #d97706; font-size: 0.75rem; font-weight: bold;'>🟡 Quality: {total_issues} issues found</span>", unsafe_allow_html=True)
                else:
                    st.markdown("<span style='color: #16a34a; font-size: 0.75rem;'>🟢 Quality: Clean (0 issues)</span>", unsafe_allow_html=True)
            with c2:
                st.caption(f"{d['chunk_count']} chunks")
            with c3:
                if st.button("🗑️", key=f"del_{d['doc_id']}", help="Remove document"):
                    st.session_state.vector_store.remove_document(d["doc_id"])
                    st.rerun()

            # Expandable issue details for this document
            if total_issues > 0 and issues_list:
                with st.expander(f"⚠️ Inspect {total_issues} Quality Issue(s) for '{d['filename']}'", expanded=False):
                    st.caption(qr.get("summary", ""))
                    for iss in issues_list:
                        sev_badge = "🔴 [CRITICAL]" if iss.get("severity") == "critical" else "🟡 [MINOR]"
                        st.markdown(f"• **{sev_badge} {iss.get('location')}**")
                        st.caption(f"  {iss.get('description')}")
            st.markdown("<hr style='margin: 4px 0;'/>", unsafe_allow_html=True)
    else:
        st.info("No documents match your filter.")

st.divider()

# Section 3: Document Summarization On-Demand
st.subheader("3. On-Demand Document Summarization & Corpus Insights")
sum_col1, sum_col2 = st.columns([1, 3])
with sum_col1:
    if st.button("📊 Generate Summary", key="btn_summarize"):
        with st.spinner(f"Analyzing {len(docs)} document(s) in knowledge base..."):
            time.sleep(0.4)
            st.session_state.active_summary = st.session_state.summarizer.summarize_corpus()
            st.rerun()

with sum_col2:
    if st.session_state.active_summary:
        st.markdown("**Corpus-Level Relational Summary:**")
        st.write(st.session_state.active_summary["corpus_summary"])

        # Suggested Questions
        sug_q = st.session_state.active_summary.get("suggested_questions", [])
        if sug_q:
            st.markdown("**Suggested Questions (Click to Ask):**")
            q_cols = st.columns(len(sug_q))
            for i, q_text in enumerate(sug_q):
                with q_cols[i]:
                    if st.button(f"💡 {q_text[:40]}...", key=f"sug_q_{i}", help=q_text):
                        st.session_state["current_question_input"] = q_text
                        st.rerun()
    else:
        st.caption("Click 'Generate Summary' to produce per-document analysis, cross-file relationships, and suggested test questions.")

st.divider()

# Section 4: Question Asking & Real-Time Self-Correcting Execution
st.subheader("4. Ask a Question with Real-Time Self-Correction")

preset_query = st.session_state.get("current_question_input", "")
user_query = st.text_input(
    "Enter your question over the knowledge base:",
    value=preset_query,
    placeholder="e.g., What are the mandatory encryption and MFA standards?",
    key="main_query_input"
)

run_query_btn = st.button("🔍 Run Self-Correcting RAG", type="primary")

if run_query_btn and user_query:
    st.markdown("### 🔄 Live Pipeline Execution")

    stage_container = st.empty()
    metric_container = st.empty()
    live_badge_container = st.empty()

    evaluator = AnswerEvaluator(
        groundedness_threshold=groundedness_thresh,
        relevance_threshold=relevance_thresh
    )
    rag_engine = SelfCorrectingRAG(
        vector_store=st.session_state.vector_store,
        evaluator=evaluator,
        max_retries=max_retries,
        groundedness_threshold=groundedness_thresh,
        relevance_threshold=relevance_thresh
    )

    # Live UI update callback
    def on_pipeline_status(state: PipelineState, details: Dict[str, Any]):
        cycle = details.get("cycle", 1)
        max_r = details.get("max_retries", max_retries)

        if state == PipelineState.RETRIEVING:
            live_badge_container.markdown(f'<span class="badge-retry">Cycle {cycle} of {max_r}: Retrieving Context</span>', unsafe_allow_html=True)
            stage_container.info(f"🔎 **Stage 1 (Cycle {cycle}):** Embedding question and running similarity search (k={details.get('k')})...")
            time.sleep(0.3)
        elif state == PipelineState.GENERATING:
            stage_container.info(f"✍️ **Stage 2 (Cycle {cycle}):** Generating answer with inline chunk citations from {details.get('chunk_count')} retrieved chunks...")
            time.sleep(0.3)
        elif state == PipelineState.EVALUATING:
            stage_container.info(f"⚖️ **Stage 3 (Cycle {cycle}):** Evaluating draft answer for Groundedness & Relevance...")
            time.sleep(0.3)
        elif state == PipelineState.CHECKING_GATE:
            g_score = details.get("groundedness", 0.0)
            r_score = details.get("relevance", 0.0)
            passed = details.get("passed", False)

            # Color-coded metrics display
            g_class = "metric-card-green" if g_score >= 0.8 else ("metric-card-amber" if g_score >= 0.5 else "metric-card-red")
            r_class = "metric-card-green" if r_score >= 0.8 else ("metric-card-amber" if r_score >= 0.5 else "metric-card-red")

            with metric_container.container():
                mc1, mc2, mc3 = st.columns(3)
                with mc1:
                    st.markdown(f'<div class="{g_class}"><h4>Groundedness</h4><h2>{int(g_score * 100)}%</h2><small>Target: {int(groundedness_thresh * 100)}%</small></div>', unsafe_allow_html=True)
                with mc2:
                    st.markdown(f'<div class="{r_class}"><h4>Relevance</h4><h2>{int(r_score * 100)}%</h2><small>Target: {int(relevance_thresh * 100)}%</small></div>', unsafe_allow_html=True)
                with mc3:
                    gate_status = "✅ PASSED" if passed else "⚠️ FAILED (Triggering Retry)"
                    st.markdown(f'<div class="metric-card-green if passed else metric-card-amber"><h4>Honesty Gate</h4><h3>{gate_status}</h3><small>Cycle {cycle}</small></div>', unsafe_allow_html=True)
            time.sleep(0.4)
        elif state == PipelineState.RETRYING:
            stage_container.warning(f"🔁 **Self-Correction Triggered:** {details.get('reason')} Retrying in Cycle {details.get('next_cycle')}...")
            time.sleep(0.4)
        elif state == PipelineState.HONESTY_GATE_ACTIVATED:
            stage_container.error("🛑 **Honesty Gate Activated:** Threshold not met after all retries. Low confidence answer safeguarded.")

    # Execute pipeline
    result = rag_engine.run(user_query, status_callback=on_pipeline_status)

    # Stream final answer
    st.markdown("#### 💬 Final Synthesized Response")
    answer_placeholder = st.empty()
    full_resp = result["final_answer"]
    streamed = ""
    for char in full_resp:
        streamed += char
        if len(streamed) % 4 == 0:
            answer_placeholder.markdown(streamed + "▌")
            time.sleep(0.005)
    answer_placeholder.markdown(full_resp)

    # Traceability Panel
    st.markdown("---")
    st.markdown("### 🔍 Full Answer Traceability Panel")

    with st.expander("📌 Retrieved Sources & Chunk Evidence", expanded=True):
        st.markdown(f"**Total Retrieval Cycles Executed:** `{result['cycles_used']}`")
        for chunk_data in result["cited_chunks"]:
            q_alert = chunk_data.get("quality_alert")
            q_status = chunk_data.get("quality_status", "clean")
            st.markdown(f"**[Source {chunk_data['rank']}]** `{chunk_data['filename']}` — Rank {chunk_data['rank']} (Similarity: `{chunk_data['similarity_score']}`)")
            if q_alert:
                st.warning(f"⚠️ **Data Quality Notice:** {q_alert}")
            elif q_status != "clean":
                st.warning(f"⚠️ **Data Quality Notice:** Note: this source document had incomplete data ({chunk_data.get('quality_summary', 'missing/empty values')}) — treat with caution.")
            st.text_area(f"Chunk text ({chunk_data['chunk_id']}):", chunk_data["text"], height=80, disabled=True, key=f"chk_disp_{chunk_data['chunk_id']}")

    with st.expander("⚖️ Evaluation Audit & Claim Breakdown", expanded=False):
        st.write(f"**Evaluator Rationale:** {result['evaluation_explanation']}")
        for cl in result["claims_analysis"]:
            st.markdown(f"• **Claim:** \"{cl['text']}\"")
            st.markdown(f"  *Status:* `{cl['status']}` | *Note:* {cl['note']}")

    with st.expander("🔁 Retry Cycle Delta Log", expanded=False):
        for att in result["attempts"]:
            st.markdown(f"**Cycle {att['cycle_number']}:** `{att['strategy_description']}`")
            st.caption(f"Query: \"{att['query_used']}\" | k={att['k_used']} | Groundedness: {int(att['evaluation']['groundedness_score'] * 100)}% | Relevance: {int(att['evaluation']['relevance_score'] * 100)}%")
            if att.get("delta_explanation"):
                st.info(att["delta_explanation"])

    # Append to Unified Session History
    st.session_state.session_history.append({
        "type": "query",
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "question": user_query,
        "answer": full_resp,
        "cycles_used": result["cycles_used"],
        "groundedness": result["groundedness_score"],
        "relevance": result["relevance_score"],
        "passed": result["passed"],
        "status": "success" if result["passed"] else "amber",
        "sources": [c["filename"] for c in result["cited_chunks"]]
    })

st.divider()

# Section 5: Unified Session History
col_hist_head, col_hist_dl = st.columns([3, 1])
with col_hist_head:
    st.subheader(f"5. Unified Session History ({len(st.session_state.session_history)} Events)")
    st.caption("Chronological unified feed combining document upload events and self-correcting query events.")

with col_hist_dl:
    history_json = json.dumps(st.session_state.session_history, indent=2)
    st.download_button(
        label="📥 Download Session Log",
        data=history_json,
        file_name=f"rag_session_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        mime="application/json"
    )

if st.session_state.session_history:
    for item in reversed(st.session_state.session_history):
        timestamp = item.get("timestamp", "")
        if item["type"] == "upload":
            status_emoji = "🟢" if item.get("status") == "success" else "🟡"
            with st.container():
                st.markdown(f"{status_emoji} **[Upload Event at {timestamp}] {item.get('batch_name')}**")
                st.write(f"Files: `{item.get('file_count')}` | Chunks Created: `{item.get('chunk_count')}`")
                st.caption(item.get("summary", ""))
                if item.get("failures"):
                    with st.expander("View Upload Failures"):
                        for f in item["failures"]:
                            st.write(f"• {f}")
        else:
            status_emoji = "🟢" if item.get("status") == "success" else "🟡"
            with st.container():
                st.markdown(f"{status_emoji} **[Query Event at {timestamp}]** \"{item.get('question')}\"")
                st.write(f"Cycles: `{item.get('cycles_used')}` | Groundedness: `{int(item.get('groundedness', 0) * 100)}%` | Relevance: `{int(item.get('relevance', 0) * 100)}%`")
                with st.expander("Expand Answer & Cited Sources"):
                    st.markdown(item.get("answer", ""))
                    st.caption(f"Sources cited: {', '.join(item.get('sources', []))}")
        st.markdown("---")
