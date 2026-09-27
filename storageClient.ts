import {
  UnifiedHistoryItem,
  SessionRecord,
  StorageStats,
  IndexedDocument,
  DocumentChunk,
} from '../types/rag';

export class StorageClient {
  /**
   * Safe fetch helper with non-blocking error handling
   */
  private static async safeFetch<T>(url: string, options?: RequestInit): Promise<T | null> {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        console.warn(`[StorageClient] Request to ${url} returned ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn(`[StorageClient] Network/Server error calling ${url}:`, err);
      return null;
    }
  }

  // Storage Stats
  public static async getStorageStats(): Promise<StorageStats | null> {
    const res = await this.safeFetch<{ success: boolean; data: StorageStats }>('/api/storage/stats');
    return res && res.success ? res.data : null;
  }

  // Sessions
  public static async listSessions(): Promise<SessionRecord[]> {
    const res = await this.safeFetch<{ success: boolean; data: SessionRecord[] }>('/api/storage/sessions');
    return res && res.success ? res.data : [];
  }

  public static async ensureSession(sessionId: string, name?: string): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>('/api/storage/sessions/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, name }),
    });
    return res?.success ?? false;
  }

  public static async deleteSession(sessionId: string): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>(`/api/storage/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    return res?.success ?? false;
  }

  // History Events
  public static async getEvents(params: {
    sessionId?: string;
    eventType?: string;
    searchQuery?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<UnifiedHistoryItem[]> {
    const query = new URLSearchParams();
    if (params.sessionId) query.append('session_id', params.sessionId);
    if (params.eventType) query.append('event_type', params.eventType);
    if (params.searchQuery) query.append('search_query', params.searchQuery);
    if (params.startDate) query.append('start_date', params.startDate);
    if (params.endDate) query.append('end_date', params.endDate);

    const res = await this.safeFetch<{ success: boolean; data: UnifiedHistoryItem[] }>(
      `/api/storage/events?${query.toString()}`
    );
    return res && res.success ? res.data : [];
  }

  public static async saveEvent(
    item: UnifiedHistoryItem,
    sessionId: string
  ): Promise<boolean> {
    const payload: Record<string, any> = { ...item };
    delete payload.id;
    delete payload.session_id;
    delete payload.type;
    delete payload.timestamp;
    delete payload.status;

    const res = await this.safeFetch<{ success: boolean }>('/api/storage/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: item.id,
        session_id: sessionId,
        event_type: item.type,
        status: item.status,
        timestamp: item.timestamp,
        payload,
      }),
    });
    return res?.success ?? false;
  }

  public static async deleteEvent(eventId: string): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>(`/api/storage/events/${eventId}`, {
      method: 'DELETE',
    });
    return res?.success ?? false;
  }

  public static async clearAllHistory(): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>('/api/storage/events', {
      method: 'DELETE',
    });
    return res?.success ?? false;
  }

  // Document & Chunks Persistence
  public static async loadDocuments(): Promise<IndexedDocument[]> {
    const res = await this.safeFetch<{ success: boolean; data: IndexedDocument[] }>('/api/storage/documents');
    return res && res.success ? res.data : [];
  }

  public static async loadChunks(): Promise<DocumentChunk[]> {
    const res = await this.safeFetch<{ success: boolean; data: DocumentChunk[] }>('/api/storage/chunks');
    return res && res.success ? res.data : [];
  }

  public static async saveDocument(doc: IndexedDocument): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>('/api/storage/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_id: doc.doc_id,
        filename: doc.filename,
        file_type: doc.file_type,
        chunk_count: doc.chunk_count,
        total_chars: doc.total_chars,
        indexed_at: doc.indexed_at,
        extraction_note: doc.extraction_note,
        quality_report: doc.quality_report,
      }),
    });
    return res?.success ?? false;
  }

  public static async saveChunks(chunks: DocumentChunk[]): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>('/api/storage/chunks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunks: chunks.map((c) => ({
          chunk_id: c.chunk_id,
          doc_id: c.doc_id,
          filename: c.filename,
          file_type: c.file_type,
          text: c.text,
          chunk_index: c.chunk_index,
          total_chunks: c.total_chunks,
          char_count: c.char_count,
          extraction_note: c.extraction_note,
          quality_status: c.quality_status,
          quality_summary: c.quality_summary,
          quality_issues: c.quality_issues,
        })),
      }),
    });
    return res?.success ?? false;
  }

  public static async deleteDocument(docId: string): Promise<boolean> {
    const res = await this.safeFetch<{ success: boolean }>(`/api/storage/documents/${docId}`, {
      method: 'DELETE',
    });
    return res?.success ?? false;
  }
}
