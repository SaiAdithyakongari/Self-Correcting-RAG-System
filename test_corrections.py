"""
Unit test for Suggested Corrections feature in python_rag.
Validates:
1. Never modifying original documents.
2. Structured suggestions: column average or cross-corpus evidence, clearly labeled.
3. Unstructured suggestions: filled ONLY if evidence exists in another doc; otherwise "no supporting information found elsewhere in the corpus to fill this gap."
4. Requires explicit user approval per suggestion before incorporation as supplemental draft chunk.
5. Traceability notices on answers using accepted suggestions.
"""

from python_rag.ingestion import DocumentIngestionEngine, DocumentChunk
from python_rag.vector_store import VectorStore
from python_rag.quality import DataQualityDetector, QualityIssue
from python_rag.corrections import CorrectionSuggester, SuggestedCorrection
from python_rag.orchestrator import SelfCorrectingRAG

def test_suggested_corrections():
    vs = VectorStore(auto_load=False)
    engine = DocumentIngestionEngine()

    # Document 1: Structured CSV with missing values in 'ARR_Millions'
    csv_content = """Company,Region,ARR_Millions,Status
AlphaCorp,NorthAmerica,120.5,Active
BetaTech,EMEA,,Active
GammaLogistics,APAC,85.2,Active
DeltaSecurity,NorthAmerica,142.0,Active
OmegaSoft,EMEA,,Active
"""
    chunks1, note1, q1 = engine.ingest_single_file("financials.csv", csv_content.encode("utf-8"), doc_id="doc_fin")
    vs.add_chunks(chunks1, q1)

    # Document 2: Architecture doc with empty section 'Data Encryption'
    doc2_content = """# System Security Architecture
## Section 1: Identity and Access Management
All users must authenticate using hardware MFA keys and temporary tokens.

## Section 2: Data Encryption

## Section 3: Audit Logging
Audit logs are shipped in real-time to an immutable append-only object store.
"""
    chunks2, note2, q2 = engine.ingest_single_file("security_spec.md", doc2_content.encode("utf-8"), doc_id="doc_sec")
    vs.add_chunks(chunks2, q2)

    # Document 3: Another document in corpus that has encryption information!
    doc3_content = """# Compliance and Cryptography Standards
Data Encryption standards mandate AES-256 for all persistent storage volumes at rest and TLS 1.3 with forward secrecy for all data in transit across internal networks.
"""
    chunks3, note3, q3 = engine.ingest_single_file("crypto_standards.md", doc3_content.encode("utf-8"), doc_id="doc_crypto")
    vs.add_chunks(chunks3, q3)

    assert q1.status != "clean"
    assert len(q1.issues) > 0

    # 1. Test structured suggestion (Intra-column aggregation)
    issue_arr = [i for i in q1.issues if "ARR_Millions" in i.location or "ARR_Millions" in i.description][0]
    corr_arr = CorrectionSuggester.suggest_for_issue("doc_fin", "financials.csv", ".csv", issue_arr, vs)
    assert corr_arr.has_corpus_evidence == True
    assert "Statistical Column Average" in corr_arr.suggested_fill
    assert corr_arr.source_type == "column_pattern"
    assert corr_arr.confidence_score > 0.0

    # Verify original document was NOT modified
    fin_chunks = [c for c in vs.chunks if c.doc_id == "doc_fin"]
    assert all("Supplemental Draft" not in c.filename for c in fin_chunks)

    # 2. Test unstructured suggestion where evidence EXISTS in another doc (doc3 crypto)
    assert len(q2.issues) > 0
    issue_enc = [i for i in q2.issues if "Data Encryption" in i.location or "Data Encryption" in i.description][0]
    corr_enc = CorrectionSuggester.suggest_for_issue("doc_sec", "security_spec.md", ".md", issue_enc, vs)
    assert corr_enc.has_corpus_evidence == True
    assert corr_enc.source_type == "cross_document"
    assert "crypto_standards.md" in corr_enc.source_document
    assert "AES-256" in corr_enc.suggested_fill
    assert corr_enc.confidence_score >= 0.65

    # 3. Test unstructured suggestion where NO evidence exists anywhere in corpus
    issue_fake = QualityIssue(
        issue_id="fake_quantum_gap",
        category="empty_section",
        severity="minor",
        location="Section 'Quantum Superconducting Fluxonium Qubits Phase Coherence'",
        description="Section 'Quantum Superconducting Fluxonium Qubits Phase Coherence' has no content."
    )
    corr_fake = CorrectionSuggester.suggest_for_issue("doc_sec", "security_spec.md", ".md", issue_fake, vs)
    assert corr_fake.has_corpus_evidence == False
    assert corr_fake.source_type == "none"
    assert corr_fake.confidence_score == 0.0
    assert "no supporting information found elsewhere in the corpus to fill this gap." in corr_fake.suggested_fill

    # 4. Test explicit user approval before incorporation
    orig_chunk_count = len(vs.chunks)
    assert CorrectionSuggester.accept_correction("doc_sec", corr_fake, vs) == False
    assert len(vs.chunks) == orig_chunk_count  # Refused ungrounded correction!

    # Accept the verified encryption correction
    assert CorrectionSuggester.accept_correction("doc_sec", corr_enc, vs) == True
    assert len(vs.chunks) == orig_chunk_count + 1
    supp_chunk = vs.chunks[-1]
    assert supp_chunk.is_supplemented == True
    assert "User-Approved Supplemental Draft" in supp_chunk.filename
    assert "AES-256" in supp_chunk.text

    # 5. Test RAG querying with traceability notice
    orchestrator = SelfCorrectingRAG(vector_store=vs)
    res = orchestrator.run("What are the mandatory data encryption standards?")
    assert res["passed"] == True
    # Verify traceability alerts indicate supplemented draft chunk was utilized
    assert any("user-approved AI suggestion" in c["quality_alert"] for c in res["cited_chunks"] if c.get("is_supplemented"))

    print("ALL 5 SUGGESTED CORRECTION REQUIREMENTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_suggested_corrections()
