# Self-Correcting RAG System

A production-grade Retrieval-Augmented Generation (RAG) system that evaluates its own answers and automatically retries retrieval when answers are poorly grounded or evidence is missing, featuring a real-time, transparent UI, multi-format ingestion, and a unified session timeline.

---

## 🎯 Problem Statement & Core Scenario

Basic RAG systems generate incomplete or poorly grounded answers when the retrieved context is insufficient or noisy. Instead of silently returning a weak or hallucinated answer, this system:
1. **Retrieves** relevant context with similarity scores and ranks.
2. **Generates** an answer with inline numbered citations `[1]`, `[2]` linking directly to chunks.
3. **Evaluates** Groundedness (support from context) and Relevance (question alignment) via automated scoring (0–100%).
4. **Detects Missing Evidence**: If either score falls below threshold (default 70%), retrieval is flagged as insufficient.
5. **Retries Retrieval**: Triggers an automated retry cycle with an adjusted strategy (Cycle 2: query rephrasing + k=7; Cycle 3: broad semantic recall + k=10).
6. **Honesty Gate**: If after 3 cycles evidence remains insufficient, the system explicitly reports **"Insufficient evidence found in document corpus"** rather than forcing an unsupported answer.
7. **Traceability**: Complete plain-English transparency into chunks, ranks, scores, claims, and attempt deltas.

---

## 🛠️ Architecture & Technology Choices

### 1. Ingestion Engine (`python_rag/ingestion.py` & `src/utils/ragEngine.ts`)
- **Supported Formats:** PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, JSON, HTML, XML, RTF, EPUB, ODT, and source code files (`.py`, `.js`, `.ts`, `.java`, `.cpp`, etc.).
- **Binary-Safe Fallback:** Unknown formats fall back to printable text extraction with the tag: `processed with generic text extraction — formatting may not be fully preserved`.
- **Chunking:** Semantic boundary preservation (500–600 chars) with sliding overlap (80–100 chars) and metadata tracking (document ID, filename, chunk index, total chunks).

### 2. High-Performance Vector Store (`python_rag/vector_store.py` & `src/utils/ragEngine.ts`)
- **Index:** Dense vector matrix operations with L2 normalization (cosine similarity equals dot product).
- **Scalability:** Fast NumPy / Float32Array matrix multiplications avoid naive linear search bottlenecks with large document sets.
- **Hybrid Retrieval:** Blends semantic vector distance with lexical keyword overlap boosts.
- **Library Management:** Instant document deletion with in-memory matrix reindexing.

### 3. Answer Evaluator (`python_rag/evaluator.py`)
- **Groundedness Scoring:** Dissects answers into discrete claims, cross-referencing against retrieved chunks to determine whether each claim is `SUPPORTED`, `PARTIALLY_SUPPORTED`, or `UNVERIFIED`.
- **Relevance Scoring:** Computes question intent alignment against answer text.
- **Transparency:** Outputs plain-English rationales and identifies specific missing evidence phrases.

### 4. Orchestrator & State Machine (`python_rag/orchestrator.py`)
- Explicit state graph: `RETRIEVING -> GENERATING -> EVALUATING -> CHECKING_GATE -> (RETRYING)* -> COMPLETED / HONESTY_GATE_ACTIVATED`.
- Tracks attempt history and calculates cycle deltas ("What changed between attempts and why").

### 5. Frontend & Full-Stack Deployment
- **Web App (AI Studio Preview):** React 19, Tailwind CSS, Lucide icons, Express 4 server on port 3000 (`server.ts`).
- **Streamlit Application:** Modular Python app (`app.py`), runnable with `streamlit run app.py`.

---

## 🚀 Setup & Execution

### Prerequisites & API Keys
- Python 3.10+ and Node.js 20+
- `GEMINI_API_KEY`: Configured in your environment or `.env` file (used by `@google/genai` on the server). If the API key is not present or experiences temporary 503 high-demand spikes, the system automatically falls back to deterministic local high-accuracy RAG synthesis.

### Running the Python Streamlit App
```bash
# Install pinned dependencies
pip install -r requirements.txt

# Run the test suite
python3 test_pipeline.py

# Launch Streamlit app
streamlit run app.py --server.port 8501
```

### Running the Full-Stack Web Application (AI Studio Preview)
```bash
# Start server on port 3000
npm run dev

# Or compile production bundle
npm run build
```

---

## 🔍 Pre-loaded Benchmark Document Corpus

The application ships pre-seeded with 4 diverse benchmark documents in `sample_documents/`:
1. `enterprise_cloud_security.md`: Zero-Trust Architecture, RBAC, JIT elevation, AES-256 encryption at rest, TLS 1.3 in transit, and disaster recovery SLA targets (RPO/RTO).
2. `ai_governance_and_evals.txt`: Groundedness metrics, relevance scoring, adaptive self-correction loops, and Honesty Gate protocols.
3. `q4_financial_operating_metrics.csv`: ARR, Net Retention Rate (NRR), Gross Margin, Cloud & LLM API spend breakdown for 2025.
4. `quantum_computing_primer.txt`: Qubits, superposition, entanglement, decoherence, and NISQ era algorithms (VQE, QAOA).

### Suggested Questions Pre-Configured:
- **Grounded Query:** *"What are the mandatory MFA and data encryption standards in the security architecture?"*
- **Financial Query:** *"What was the YoY growth rate of ARR and the gross margin in Q4 2025?"*
- **Out-of-Corpus Query (Demonstrates Honesty Gate):** *"What are the breeding habits of Emperor Penguins in Antarctica during winter?"*

---

## 🧪 Verified Test Results

Running `python3 test_pipeline.py` confirms all 5 core requirements:
```
=== [TEST 1] Document Ingestion & Chunking ===
Found 4 sample files: ['ai_governance_and_evals.txt', 'enterprise_cloud_security.md', 'q4_financial_operating_metrics.csv', 'quantum_computing_primer.txt']
  -> Ingested ai_governance_and_evals.txt: 9 chunks (native)
  -> Ingested enterprise_cloud_security.md: 8 chunks (native)
  -> Ingested q4_financial_operating_metrics.csv: 3 chunks (native)
  -> Ingested quantum_computing_primer.txt: 7 chunks (native)
Total chunks indexed in Vector Store: 27

=== [TEST 2] Document Summarization & Question Extraction ===
Corpus Summary:
  The indexed corpus comprises 4 document(s) partitioned into 27 semantic chunks. Key cross-cutting technical themes include: Governance, Hallucination, Prevention, Evaluation, Protocols, Metrics, Enterprise, Cloud.
Suggested Questions:
  - What are the mandatory MFA and data encryption standards in the security architecture?
  - How does the Honesty Gate protocol work when evaluation scores fall below threshold?
  - What was the YoY growth rate of ARR and the gross margin in Q4 2025?

=== [TEST 3] Self-Correcting RAG Query (Grounded Answer) ===
Question: What are the MFA and encryption at rest standards for cloud security?
Cycles used: 1
Passed: True
Groundedness: 1.0 (100%)
Relevance: 1.0 (100%)
Citations: 4 chunks cited

=== [TEST 4] Honesty Gate Activation (Out-of-Corpus Query) ===
Question: What are the breeding habits of Emperor Penguins in Antarctica during winter?
Cycles used: 3 (Auto-retried across all 3 cycles)
Honesty Gate Triggered: True
Passed: False
Outcome: Safely returned "Insufficient Evidence Found in Document Corpus" warning

=== [TEST 5] Library Deletion & Vector Matrix Integrity ===
Successfully removed document from vector store without memory corruption.

✅ ALL 5 PIPELINE INTEGRATION TESTS PASSED CLEANLY!
```
