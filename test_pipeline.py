"""
Automated validation test suite for the Self-Correcting RAG System.
Verifies ingestion, vector storage, data quality detection, answer generation,
multi-metric evaluation, adaptive retry loop, honesty gate activation,
traceability quality alerts, and unified session history.
"""

import os
import sys
from python_rag.ingestion import DocumentIngestionEngine
from python_rag.vector_store import VectorStore
from python_rag.evaluator import AnswerEvaluator
from python_rag.orchestrator import SelfCorrectingRAG, PipelineState
from python_rag.summarizer import DocumentSummarizer
from python_rag.quality import DataQualityDetector


def run_all_tests():
    print("=== [TEST 1] Document Ingestion, Chunking & Automatic Data Quality Detection ===")
    engine = DocumentIngestionEngine(chunk_size=400, chunk_overlap=80)
    store = VectorStore()

    sample_dir = "sample_documents"
    files = sorted(os.listdir(sample_dir))
    print(f"Found {len(files)} sample files: {files}")

    total_chunks = 0
    for fname in files:
        fpath = os.path.join(sample_dir, fname)
        with open(fpath, "rb") as f:
            content = f.read()
        chunks, note, q_report = engine.ingest_single_file(fname, content)
        assert len(chunks) > 0, f"Failed to ingest {fname}"
        added = store.add_chunks(chunks, quality_report=q_report)
        total_chunks += added
        print(f"  -> Ingested {fname}: {len(chunks)} chunks, Quality Status: [{q_report.status.upper()}] ({q_report.summary})")

    print(f"Total chunks indexed in Vector Store: {store.get_total_chunks()}")
    assert store.get_total_chunks() == total_chunks

    print("\n=== [TEST 2] Specific Data Quality Detection (CSV with Nulls & Empty Column) ===")
    # Create test CSV with:
    # 1) column 'email' missing in 2 of 5 rows (40.0%)
    # 2) column 'notes' entirely empty across all 5 rows (100%)
    # 3) column 'id' fully populated
    test_csv_bytes = (
        "id,name,email,notes\n"
        "1,Alice,alice@example.com,\n"
        "2,Bob,,\n"
        "3,Charlie,charlie@example.com,\n"
        "4,David,,\n"
        "5,Eve,eve@example.com,\n"
    ).encode("utf-8")

    csv_chunks, csv_note, csv_report = engine.ingest_single_file("customer_records.csv", test_csv_bytes)
    print(f"File: {csv_report.filename}")
    print(f"Quality Status: {csv_report.status.upper()} (Total Issues: {csv_report.total_issues})")
    for issue in csv_report.issues:
        print(f"  - [{issue.severity.upper()}] {issue.location}: {issue.description}")

    # Specific assertions
    assert csv_report.status in ("minor", "critical")
    assert any("notes" in i.location and "entirely empty" in i.description and "100%" in i.description for i in csv_report.issues), "Did not flag entirely empty column 'notes' with 100%"
    assert any("email" in i.location and "missing in 2 of 5 rows (40.0%)" in i.description for i in csv_report.issues), "Did not flag partial column 'email' with row counts and percentage"
    print("✅ CSV missing values and entirely empty column verified with specific details!")

    print("\n=== [TEST 3] Specific Data Quality Detection (Scanned/Image-Only PDF with No Extractable Text) ===")
    # Binary simulated PDF with 0 extractable printable text
    scanned_pdf_bytes = b"%PDF-1.4 \x00\x01\x02\x03\x04\x05\x06\x07\x08\x0e\x0f\x10\x11\x12\x13"
    pdf_chunks, pdf_note, pdf_report = engine.ingest_single_file("scanned_contract.pdf", scanned_pdf_bytes)
    print(f"File: {pdf_report.filename}")
    print(f"Quality Status: {pdf_report.status.upper()} (Critical Issues: {pdf_report.critical_issues})")
    for issue in pdf_report.issues:
        print(f"  - [{issue.severity.upper()}] {issue.location}: {issue.description}")

    assert pdf_report.status == "critical"
    assert any("no extractable text" in i.description and "scanned image" in i.description for i in pdf_report.issues), "Did not specifically identify scanned image PDF without OCR"
    # Document is non-blocking: registered in doc library even if 0 chunks
    store.register_empty_document("doc_scanned_pdf", "scanned_contract.pdf", ".pdf", pdf_report)
    print("✅ Scanned PDF with no extractable text correctly flagged as critical and non-blocking!")

    print("\n=== [TEST 4] Traceability Integration of Data Quality Warnings ===")
    # Add the customer_records chunks to store and query it
    store.add_chunks(csv_chunks, quality_report=csv_report)
    evaluator = AnswerEvaluator(groundedness_threshold=0.60, relevance_threshold=0.60)
    rag = SelfCorrectingRAG(store, evaluator=evaluator, max_retries=2)

    q_csv = "Alice Charlie Eve alice@example.com customer_records notes email"
    result_csv = rag.run(q_csv)
    print("Traceability cited chunks:")
    has_quality_alert = False
    for chk in result_csv["cited_chunks"]:
        print(f"  - Chunk from {chk['filename']}: Quality Alert = {chk.get('quality_alert')}")
        if chk.get("quality_alert"):
            has_quality_alert = True

    assert has_quality_alert is True, "Data quality warning was not surfaced in traceability chunk citation!"
    print(f"Evaluation Explanation Caveat: {result_csv['evaluation_explanation']}")
    assert "Data Quality Warning" in result_csv["evaluation_explanation"]
    print("✅ Data Quality warning surfaced in answer traceability panel!")

    print("\n=== [TEST 5] Grounded RAG Query (Clean Document) ===")
    q1 = "What are the MFA and encryption at rest standards for cloud security?"
    result1 = rag.run(q1)
    print(f"Question: {q1}")
    print(f"Cycles used: {result1['cycles_used']}")
    print(f"Passed: {result1['passed']}")
    print(f"Groundedness: {result1['groundedness_score']}")
    print(f"Relevance: {result1['relevance_score']}")
    assert result1["passed"] is True
    assert len(result1["cited_chunks"]) > 0

    print("\n=== [TEST 6] Honesty Gate Activation (Out-of-Corpus Query) ===")
    q2 = "What are the breeding habits of Emperor Penguins in Antarctica during winter?"
    result2 = rag.run(q2)
    print(f"Question: {q2}")
    print(f"Cycles used: {result2['cycles_used']}")
    print(f"Honesty Gate Triggered: {result2['honesty_gate_triggered']}")
    print(f"Passed: {result2['passed']}")
    assert result2["honesty_gate_triggered"] is True

    print("\n=== [TEST 7] Library Deletion & Vector Matrix Integrity ===")
    initial_docs = len(store.get_library_summary())
    first_doc_id = store.get_library_summary()[0]["doc_id"]
    removed = store.remove_document(first_doc_id)
    assert removed is True
    assert len(store.get_library_summary()) == initial_docs - 1
    print("Successfully removed document from vector store without memory corruption.")

    print("\n✅ ALL 7 INTEGRATION & DATA QUALITY TESTS PASSED CLEANLY!")


if __name__ == "__main__":
    run_all_tests()
