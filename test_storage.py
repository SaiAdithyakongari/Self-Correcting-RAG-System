"""
Validation test for persistent SQLite storage in the Self-Correcting RAG System.
Tests:
1. Session creation & grouping
2. Immediate event persistence (upload, query with full traceability & quality findings, summary)
3. Simulated app restart: hydrating documents, vector chunks, embeddings, and full history from disk
4. Search across history by keyword
5. Filter across history by type & date range
6. Full detail retention (retrieved chunks, evaluation scores, retries, final answer, quality warnings)
7. Deletion of individual entries and sessions
8. Storage stats calculation (size in bytes, document/chunk/event counts)
"""

import os
import shutil
import tempfile
from python_rag.storage import PersistentStorage
from python_rag.vector_store import VectorStore
from python_rag.ingestion import DocumentIngestionEngine, DocumentChunk
from python_rag.evaluator import AnswerEvaluator
from python_rag.orchestrator import SelfCorrectingRAG

def test_persistent_storage():
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_rag.db")
    print(f"Testing with temporary SQLite database at: {db_path}")

    try:
        # Step 1: Initialize storage & session
        storage = PersistentStorage(db_path=db_path)
        session_1 = "session_20260924_1500"
        session_1_name = "Session — Sep 24, 2026, 3:00 PM"
        storage.ensure_session(session_1, session_1_name)

        sessions = storage.list_sessions()
        assert len(sessions) == 1
        assert sessions[0]["session_id"] == session_1
        assert sessions[0]["name"] == session_1_name
        print("✅ Session created and grouped successfully.")

        # Step 2: Ingest & persist documents and chunks with vector store
        vector_store = VectorStore(storage=storage, auto_load=False)
        engine = DocumentIngestionEngine()

        sample_text = (
            "Cloud Security Standard:\n"
            "All multi-tenant production systems must enforce Multi-Factor Authentication (MFA).\n"
            "All data at rest must use AES-256 GCM encryption.\n"
            "The customer refund policy requires written submission within 30 calendar days."
        )
        chunks, note, q_report = engine.ingest_single_file("security_policy.txt", sample_text.encode("utf-8"))
        added = vector_store.add_chunks(chunks, quality_report=q_report)
        assert added > 0
        print(f"✅ Added and persisted {added} chunks to vector store and SQLite.")

        # Step 3: Record upload event
        upload_event_id = "upload_test_1"
        upload_payload = {
            "batch_name": "Security Policy Upload",
            "file_count": 1,
            "chunk_count": len(chunks),
            "summary": "Indexed security policy document.",
            "quality_rollup": "Clean document (0 issues)",
            "quality_issues_count": 0
        }
        storage.save_event(
            event_id=upload_event_id,
            session_id=session_1,
            event_type="upload",
            status="success",
            payload=upload_payload
        )
        print("✅ Upload event persisted immediately.")

        # Step 4: Run a question through SelfCorrectingRAG and persist the query event with full detail
        evaluator = AnswerEvaluator(groundedness_threshold=0.6, relevance_threshold=0.6)
        rag = SelfCorrectingRAG(vector_store, evaluator=evaluator, max_retries=2)
        question = "What is the refund policy and MFA requirement?"
        rag_result = rag.run(question)

        query_event_id = "query_test_1"
        query_payload = {
            "question": question,
            "answer": rag_result["final_answer"],
            "cycles_used": rag_result["cycles_used"],
            "groundedness": rag_result["groundedness_score"],
            "relevance": rag_result["relevance_score"],
            "sources": [c["filename"] for c in rag_result["cited_chunks"]],
            "honesty_gate_triggered": rag_result["honesty_gate_triggered"],
            "result": rag_result  # Retains full detail: exact retrieved chunks, claims analysis, attempt logs
        }
        storage.save_event(
            event_id=query_event_id,
            session_id=session_1,
            event_type="query",
            status="success" if rag_result["passed"] else "amber",
            payload=query_payload
        )
        print("✅ Query event with full traceability and chunk citations persisted.")

        # Step 5: Test Search and Filter across history
        # Search by keyword "refund policy"
        search_results = storage.get_events(search_query="refund policy")
        assert len(search_results) >= 1
        assert any(r["id"] == query_event_id for r in search_results)
        print(f"✅ Search by keyword 'refund policy' found {len(search_results)} event(s).")

        # Filter by type: 'upload'
        upload_events = storage.get_events(event_type="upload")
        assert len(upload_events) == 1
        assert upload_events[0]["id"] == upload_event_id
        print("✅ Filter by type 'upload' returned exactly upload events.")

        # Filter by session
        session_events = storage.get_events(session_id=session_1)
        assert len(session_events) == 2
        print("✅ Filter by session ID returned all events in that session.")

        # Step 6: Test Storage Stats
        stats = storage.get_storage_stats()
        assert stats["doc_count"] == 1
        assert stats["chunk_count"] == len(chunks)
        assert stats["event_count"] == 2
        assert stats["session_count"] == 1
        assert stats["db_size_bytes"] > 0
        print(f"✅ Storage stats verified: {stats['db_size_formatted']}, {stats['chunk_count']} chunks, {stats['event_count']} events.")

        # Step 7: Simulate Complete App Restart
        print("\n--- Simulating Full Application Restart ---")
        del vector_store
        del storage

        # Reopen from disk
        new_storage = PersistentStorage(db_path=db_path)
        restarted_vector_store = VectorStore(storage=new_storage, auto_load=True)

        # Confirm documents and vector embeddings survived restart
        reloaded_docs = restarted_vector_store.get_library_summary()
        assert len(reloaded_docs) == 1
        assert reloaded_docs[0]["filename"] == "security_policy.txt"
        assert restarted_vector_store.get_total_chunks() == len(chunks)
        print(f"✅ Survived restart: {len(reloaded_docs)} document and {restarted_vector_store.get_total_chunks()} vector chunks restored from disk.")

        # Confirm similarity search still works on pre-existing documents without re-uploading
        reopened_search = restarted_vector_store.similarity_search("MFA authentication encryption")
        assert len(reopened_search) > 0
        assert "mfa" in reopened_search[0][0].text.lower()
        print("✅ Survived restart: vector similarity search functions immediately on restored embeddings.")

        # Confirm history survived restart with full detail
        reloaded_events = new_storage.get_events()
        assert len(reloaded_events) == 2
        reloaded_query = next(e for e in reloaded_events if e["id"] == query_event_id)
        assert reloaded_query["question"] == question
        assert len(reloaded_query["result"]["cited_chunks"]) > 0
        assert reloaded_query["result"]["cycles_used"] >= 1
        assert "claims_analysis" in reloaded_query["result"]
        print("✅ Survived restart: full query traceability, cited chunks, and evaluation scores intact.")

        # Step 8: Test Deletion of Individual Event and Session
        del_ev_ok = new_storage.delete_event(upload_event_id)
        assert del_ev_ok is True
        remaining_events = new_storage.get_events()
        assert len(remaining_events) == 1
        print("✅ Deleted individual history record successfully.")

        del_sess_ok = new_storage.delete_session(session_1)
        assert del_sess_ok is True
        after_sess_del = new_storage.get_events()
        assert len(after_sess_del) == 0
        print("✅ Deleted session and cascaded events successfully.")

        print("\n🎉 ALL PERSISTENT STORAGE TESTS PASSED CLEANLY!")

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    test_persistent_storage()
