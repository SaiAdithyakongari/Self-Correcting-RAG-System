"""
Persistent storage backend using SQLite for the Self-Correcting RAG System.
Handles atomic, error-wrapped persistence for:
1. Sessions (session metadata, created/updated timestamps)
2. History events (uploads, queries, summaries, data quality findings, evaluation details)
3. Indexed documents (metadata, chunk count, quality reports)
4. Vector store chunks (chunk text, doc_id, index, quality status/alerts, precomputed embeddings)

Ensures that after an app restart or page refresh:
- Previously indexed documents and their vector embeddings survive without re-uploading
- Past questions, full answer traceability (retrieved chunks, scores, retry attempts) survive
- History entries are grouped by session with search, filtering, and export capabilities.
"""

import os
import json
import sqlite3
import struct
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

try:
    import numpy as np
except ImportError:
    np = None

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
DB_PATH = os.path.join(DB_DIR, "rag_storage.db")


class PersistentStorage:
    """
    Lightweight SQLite persistent storage engine for single-user RAG workbench.
    Safely wraps all operations in try-except blocks so failures never crash the app.
    """

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_tables()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_tables(self) -> None:
        """Create necessary database tables if they do not exist."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                # Sessions table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS sessions (
                        session_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        last_active_at TEXT NOT NULL
                    )
                """)

                # History events table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS history_events (
                        event_id TEXT PRIMARY KEY,
                        session_id TEXT NOT NULL,
                        event_type TEXT NOT NULL, -- 'upload', 'query', 'summary'
                        timestamp TEXT NOT NULL,
                        status TEXT NOT NULL, -- 'success', 'amber'
                        payload_json TEXT NOT NULL,
                        FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
                    )
                """)
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_session ON history_events (session_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON history_events (event_type)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON history_events (timestamp)")

                # Documents table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS documents (
                        doc_id TEXT PRIMARY KEY,
                        filename TEXT NOT NULL,
                        file_type TEXT NOT NULL,
                        chunk_count INTEGER NOT NULL DEFAULT 0,
                        total_chars INTEGER NOT NULL DEFAULT 0,
                        indexed_at TEXT NOT NULL,
                        extraction_note TEXT,
                        quality_report_json TEXT
                    )
                """)

                # Chunks table (with serialized vector embeddings)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS chunks (
                        chunk_id TEXT PRIMARY KEY,
                        doc_id TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        file_type TEXT NOT NULL,
                        text TEXT NOT NULL,
                        chunk_index INTEGER NOT NULL,
                        total_chunks INTEGER NOT NULL,
                        char_count INTEGER NOT NULL,
                        extraction_note TEXT,
                        quality_status TEXT NOT NULL DEFAULT 'clean',
                        quality_summary TEXT,
                        quality_issues_json TEXT,
                        embedding_blob BLOB,
                        FOREIGN KEY (doc_id) REFERENCES documents (doc_id) ON DELETE CASCADE
                    )
                """)
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks (doc_id)")

                conn.commit()
        except Exception as e:
            print(f"[PersistentStorage Warning] Failed initializing database schema: {e}")

    # ==========================================
    # Session Management
    # ==========================================

    def ensure_session(self, session_id: str, name: Optional[str] = None) -> bool:
        """Create a session if it doesn't already exist, or update last_active_at."""
        try:
            now_iso = datetime.now().isoformat()
            if not name:
                display_time = datetime.now().strftime("%b %d, %Y, %I:%M %p")
                name = f"Session — {display_time}"

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO sessions (session_id, name, created_at, last_active_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        last_active_at = excluded.last_active_at
                """, (session_id, name, now_iso, now_iso))
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] ensure_session failed: {e}")
            return False

    def list_sessions(self) -> List[Dict[str, Any]]:
        """Return list of all sessions sorted by last active descending."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT s.session_id, s.name, s.created_at, s.last_active_at,
                           COUNT(h.event_id) as event_count
                    FROM sessions s
                    LEFT JOIN history_events h ON s.session_id = h.session_id
                    GROUP BY s.session_id
                    ORDER BY s.last_active_at DESC
                """)
                rows = cursor.fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            print(f"[PersistentStorage Warning] list_sessions failed: {e}")
            return []

    def delete_session(self, session_id: str) -> bool:
        """Delete an entire session and all its associated history events."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM history_events WHERE session_id = ?", (session_id,))
                cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] delete_session failed: {e}")
            return False

    # ==========================================
    # History Events Management
    # ==========================================

    def save_event(
        self,
        event_id: str,
        session_id: str,
        event_type: str,
        status: str,
        payload: Dict[str, Any],
        timestamp: Optional[str] = None
    ) -> bool:
        """Immediately save an event (upload, query, summary) into persistent storage."""
        try:
            if not timestamp:
                timestamp = datetime.now().isoformat()
            self.ensure_session(session_id)

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT OR REPLACE INTO history_events (
                        event_id, session_id, event_type, timestamp, status, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    event_id,
                    session_id,
                    event_type,
                    timestamp,
                    status,
                    json.dumps(payload, default=str)
                ))
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] save_event failed: {e}")
            return False

    def get_events(
        self,
        session_id: Optional[str] = None,
        event_type: Optional[str] = None,
        search_query: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Query history events with optional filters."""
        try:
            query = "SELECT * FROM history_events WHERE 1=1"
            params: List[Any] = []

            if session_id:
                query += " AND session_id = ?"
                params.append(session_id)

            if event_type and event_type != "all":
                query += " AND event_type = ?"
                params.append(event_type)

            if start_date:
                query += " AND timestamp >= ?"
                params.append(start_date)

            if end_date:
                query += " AND timestamp <= ?"
                params.append(end_date)

            query += " ORDER BY timestamp DESC"

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params)
                rows = cursor.fetchall()

                results: List[Dict[str, Any]] = []
                for r in rows:
                    payload = json.loads(r["payload_json"])
                    item = {
                        "id": r["event_id"],
                        "session_id": r["session_id"],
                        "type": r["event_type"],
                        "timestamp": r["timestamp"],
                        "status": r["status"],
                        **payload
                    }

                    # In-memory search filtering on payload content (question, answer, summary, filename)
                    if search_query:
                        sq = search_query.lower()
                        match = False
                        if sq in item.get("question", "").lower():
                            match = True
                        elif sq in item.get("answer", "").lower():
                            match = True
                        elif sq in item.get("batch_name", "").lower():
                            match = True
                        elif sq in item.get("summary", "").lower():
                            match = True
                        elif sq in str(item.get("sources", [])).lower():
                            match = True
                        elif sq in str(item.get("quality_rollup", "")).lower():
                            match = True
                        if not match:
                            continue

                    results.append(item)

                return results
        except Exception as e:
            print(f"[PersistentStorage Warning] get_events failed: {e}")
            return []

    def delete_event(self, event_id: str) -> bool:
        """Delete an individual history record."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM history_events WHERE event_id = ?", (event_id,))
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] delete_event failed: {e}")
            return False

    def clear_all_history(self) -> bool:
        """Clear all history events."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM history_events")
                cursor.execute("DELETE FROM sessions")
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] clear_all_history failed: {e}")
            return False

    # ==========================================
    # Documents & Vector Store Persistence
    # ==========================================

    def save_document(
        self,
        doc_id: str,
        filename: str,
        file_type: str,
        chunk_count: int,
        total_chars: int,
        indexed_at: str,
        extraction_note: Optional[str] = None,
        quality_report: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Persist document metadata into SQLite."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT OR REPLACE INTO documents (
                        doc_id, filename, file_type, chunk_count, total_chars,
                        indexed_at, extraction_note, quality_report_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    doc_id,
                    filename,
                    file_type,
                    chunk_count,
                    total_chars,
                    indexed_at,
                    extraction_note,
                    json.dumps(quality_report) if quality_report else None
                ))
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] save_document failed: {e}")
            return False

    def save_chunks_batch(
        self,
        chunks_data: List[Dict[str, Any]]
    ) -> bool:
        """
        Persist a batch of chunks along with their precomputed float32 embeddings.
        chunks_data item schema:
        {
          chunk_id, doc_id, filename, file_type, text, chunk_index,
          total_chunks, char_count, extraction_note, quality_status,
          quality_summary, quality_issues, embedding (np.ndarray or list)
        }
        """
        try:
            rows_to_insert = []
            for c in chunks_data:
                emb = c.get("embedding")
                emb_blob = None
                if emb is not None:
                    if np is not None and isinstance(emb, np.ndarray):
                        emb_blob = emb.astype(np.float32).tobytes()
                    elif isinstance(emb, (list, tuple)):
                        if np is not None:
                            emb_blob = np.array(emb, dtype=np.float32).tobytes()
                        else:
                            emb_blob = struct.pack(f"{len(emb)}f", *emb)

                q_issues = c.get("quality_issues")
                rows_to_insert.append((
                    c["chunk_id"],
                    c["doc_id"],
                    c["filename"],
                    c["file_type"],
                    c["text"],
                    c["chunk_index"],
                    c["total_chunks"],
                    c.get("char_count", len(c["text"])),
                    c.get("extraction_note"),
                    c.get("quality_status", "clean"),
                    c.get("quality_summary"),
                    json.dumps(q_issues) if q_issues else None,
                    emb_blob
                ))

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.executemany("""
                    INSERT OR REPLACE INTO chunks (
                        chunk_id, doc_id, filename, file_type, text, chunk_index,
                        total_chunks, char_count, extraction_note, quality_status,
                        quality_summary, quality_issues_json, embedding_blob
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, rows_to_insert)
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] save_chunks_batch failed: {e}")
            return False

    def load_all_documents(self) -> List[Dict[str, Any]]:
        """Load all indexed documents from persistent storage."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM documents ORDER BY indexed_at ASC")
                rows = cursor.fetchall()
                docs = []
                for r in rows:
                    q_rep = json.loads(r["quality_report_json"]) if r["quality_report_json"] else None
                    docs.append({
                        "doc_id": r["doc_id"],
                        "filename": r["filename"],
                        "file_type": r["file_type"],
                        "chunk_count": r["chunk_count"],
                        "total_chars": r["total_chars"],
                        "indexed_at": r["indexed_at"],
                        "extraction_note": r["extraction_note"],
                        "quality_report": q_rep
                    })
                return docs
        except Exception as e:
            print(f"[PersistentStorage Warning] load_all_documents failed: {e}")
            return []

    def load_all_chunks(self) -> List[Dict[str, Any]]:
        """Load all vector chunks with decoded embedding vectors."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM chunks ORDER BY doc_id, chunk_index")
                rows = cursor.fetchall()
                chunks = []
                for r in rows:
                    q_issues = json.loads(r["quality_issues_json"]) if r["quality_issues_json"] else []
                    emb = None
                    if r["embedding_blob"]:
                        if np is not None:
                            emb = np.frombuffer(r["embedding_blob"], dtype=np.float32)
                        else:
                            blob = r["embedding_blob"]
                            num_floats = len(blob) // 4
                            emb = list(struct.unpack(f"{num_floats}f", blob))

                    chunks.append({
                        "chunk_id": r["chunk_id"],
                        "doc_id": r["doc_id"],
                        "filename": r["filename"],
                        "file_type": r["file_type"],
                        "text": r["text"],
                        "chunk_index": r["chunk_index"],
                        "total_chunks": r["total_chunks"],
                        "char_count": r["char_count"],
                        "extraction_note": r["extraction_note"],
                        "quality_status": r["quality_status"],
                        "quality_summary": r["quality_summary"],
                        "quality_issues": q_issues,
                        "embedding": emb
                    })
                return chunks
        except Exception as e:
            print(f"[PersistentStorage Warning] load_all_chunks failed: {e}")
            return []

    def delete_document(self, doc_id: str) -> bool:
        """Remove a document and its chunks from persistent storage."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
                cursor.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
                conn.commit()
            return True
        except Exception as e:
            print(f"[PersistentStorage Warning] delete_document failed: {e}")
            return False

    def get_storage_stats(self) -> Dict[str, Any]:
        """Return total disk storage footprint and counts."""
        try:
            db_size_bytes = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM documents")
                doc_count = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM chunks")
                chunk_count = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM history_events")
                event_count = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM sessions")
                session_count = cursor.fetchone()[0]

            return {
                "db_path": self.db_path,
                "db_size_bytes": db_size_bytes,
                "db_size_formatted": self._format_bytes(db_size_bytes),
                "doc_count": doc_count,
                "chunk_count": chunk_count,
                "event_count": event_count,
                "session_count": session_count
            }
        except Exception as e:
            print(f"[PersistentStorage Warning] get_storage_stats failed: {e}")
            return {
                "db_path": self.db_path,
                "db_size_bytes": 0,
                "db_size_formatted": "0 B",
                "doc_count": 0,
                "chunk_count": 0,
                "event_count": 0,
                "session_count": 0
            }

    @staticmethod
    def _format_bytes(size: int) -> str:
        for unit in ["B", "KB", "MB", "GB"]:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} TB"
