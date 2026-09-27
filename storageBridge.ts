import { spawn } from 'child_process';
import path from 'path';

/**
 * Execute a python command and return parsed JSON stdout.
 */
export function runPythonStorage(action: string, args: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const inputPayload = JSON.stringify({ action, args });

    const pyScript = `
import sys
import json
from python_rag.storage import PersistentStorage

def handle():
    try:
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}
        action = req.get("action", "")
        args = req.get("args", {})
        storage = PersistentStorage()

        if action == "list_sessions":
            res = storage.list_sessions()
            print(json.dumps({"success": True, "data": res}))
        elif action == "ensure_session":
            s_id = args.get("session_id")
            name = args.get("name")
            ok = storage.ensure_session(s_id, name)
            print(json.dumps({"success": ok}))
        elif action == "delete_session":
            s_id = args.get("session_id")
            ok = storage.delete_session(s_id)
            print(json.dumps({"success": ok}))
        elif action == "save_event":
            e_id = args.get("event_id")
            s_id = args.get("session_id")
            e_type = args.get("event_type")
            status = args.get("status")
            payload = args.get("payload", {})
            ts = args.get("timestamp")
            ok = storage.save_event(e_id, s_id, e_type, status, payload, ts)
            print(json.dumps({"success": ok}))
        elif action == "get_events":
            s_id = args.get("session_id")
            e_type = args.get("event_type")
            sq = args.get("search_query")
            start = args.get("start_date")
            end = args.get("end_date")
            events = storage.get_events(s_id, e_type, sq, start, end)
            print(json.dumps({"success": True, "data": events}))
        elif action == "delete_event":
            e_id = args.get("event_id")
            ok = storage.delete_event(e_id)
            print(json.dumps({"success": ok}))
        elif action == "clear_all_history":
            ok = storage.clear_all_history()
            print(json.dumps({"success": ok}))
        elif action == "save_document":
            ok = storage.save_document(
                doc_id=args.get("doc_id"),
                filename=args.get("filename"),
                file_type=args.get("file_type"),
                chunk_count=args.get("chunk_count", 0),
                total_chars=args.get("total_chars", 0),
                indexed_at=args.get("indexed_at"),
                extraction_note=args.get("extraction_note"),
                quality_report=args.get("quality_report")
            )
            print(json.dumps({"success": ok}))
        elif action == "save_chunks":
            chunks = args.get("chunks", [])
            ok = storage.save_chunks_batch(chunks)
            print(json.dumps({"success": ok}))
        elif action == "load_documents":
            docs = storage.load_all_documents()
            print(json.dumps({"success": True, "data": docs}))
        elif action == "load_chunks":
            raw_chunks = storage.load_all_chunks()
            # Convert numpy float arrays or None to lists for JSON transfer
            for c in raw_chunks:
                if c.get("embedding") is not None:
                    c["embedding"] = c["embedding"].tolist()
            print(json.dumps({"success": True, "data": raw_chunks}))
        elif action == "delete_document":
            doc_id = args.get("doc_id")
            ok = storage.delete_document(doc_id)
            print(json.dumps({"success": ok}))
        elif action == "get_storage_stats":
            stats = storage.get_storage_stats()
            print(json.dumps({"success": True, "data": stats}))
        else:
            print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    handle()
`;

    const pyProcess = spawn('python3', ['-c', pyScript], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    pyProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pyProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python storage process exited with code ${code}: ${stderr}`);
        return resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err: any) {
        console.error('Failed to parse python storage response:', stdout, err);
        resolve({ success: false, error: err.message, raw: stdout });
      }
    });

    pyProcess.on('error', (err) => {
      console.error('Failed to spawn python storage process:', err);
      resolve({ success: false, error: err.message });
    });

    pyProcess.stdin.write(inputPayload);
    pyProcess.stdin.end();
  });
}
