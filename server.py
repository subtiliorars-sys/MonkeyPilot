# server.py - Lightweight CORS-Enabled Python Local Server for Agent Log Syncing & Workspace Operations
import http.server
import json
import os
import subprocess
import socketserver

PORT = 5000
WORKSPACE_ROOT = os.path.abspath(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = os.path.join(WORKSPACE_ROOT, "live_test_logs.json")
SESSIONS_FILE = os.path.join(WORKSPACE_ROOT, "agent_sessions.json")


def resolve_workspace_path(rel_path):
    """Resolve a relative path under WORKSPACE_ROOT, or None if outside the workspace."""
    if not rel_path or os.path.isabs(rel_path):
        return None
    abs_path = os.path.abspath(os.path.join(WORKSPACE_ROOT, rel_path))
    try:
        if os.path.commonpath([abs_path, WORKSPACE_ROOT]) != WORKSPACE_ROOT:
            return None
    except ValueError:
        return None
    return abs_path

# Use ThreadingHTTPServer if available (Python 3.7+), otherwise fallback to custom class
if hasattr(http.server, "ThreadingHTTPServer"):
    ServerClass = http.server.ThreadingHTTPServer
else:
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
    ServerClass = ThreadingHTTPServer

class LogSyncHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        # Enable CORS preflight responses
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def get_post_payload(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        return json.loads(post_data.decode("utf-8"))

    def do_GET(self):
        parsed_path = self.path.split('?')[0]

        # 1. Fetch Log History
        if parsed_path in ("/", "/logs"):
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, "r", encoding="utf-8") as f:
                    try:
                        data = json.load(f)
                    except Exception:
                        data = []
                self.send_json(200, data)
            else:
                self.send_json(200, {"status": "no logs logged yet"})

        # 2. Get Workspace Directory Structure
        elif parsed_path == "/workspace/files":
            try:
                files = []
                ignored_dirs = {".git", "node_modules", "__pycache__", ".tmp", "assets"}
                for root, dirs, filenames in os.walk(WORKSPACE_ROOT):
                    dirs[:] = [d for d in dirs if d not in ignored_dirs]
                    for name in filenames:
                        rel = os.path.relpath(os.path.join(root, name), WORKSPACE_ROOT)
                        files.append(rel)
                self.send_json(200, {"status": "success", "files": files})
            except Exception as e:
                self.send_json(500, {"status": "error", "message": str(e)})

        # 3. Retrieve Agent Sessions State
        elif parsed_path == "/agent/session":
            try:
                if os.path.exists(SESSIONS_FILE):
                    with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    self.send_json(200, data)
                else:
                    self.send_json(200, {"status": "success", "sessions": []})
            except Exception as e:
                self.send_json(500, {"status": "error", "message": str(e)})

        else:
            self.send_json(404, {"status": "error", "message": "Not Found"})

    def do_POST(self):
        parsed_path = self.path.split('?')[0]

        try:
            payload = self.get_post_payload()
        except Exception as e:
            self.send_json(400, {"status": "error", "message": "Invalid JSON payload: " + str(e)})
            return

        try:
            # 1. Append Log Entry
            if parsed_path in ("/", "/logs"):
                history = []
                if os.path.exists(LOG_FILE):
                    try:
                        with open(LOG_FILE, "r", encoding="utf-8") as f:
                            history = json.load(f)
                            if not isinstance(history, list):
                                history = []
                    except Exception:
                        history = []
                
                history.append(payload)
                if len(history) > 100:
                    history = history[-100:]
                    
                with open(LOG_FILE, "w", encoding="utf-8") as f:
                    json.dump(history, f, indent=2)
                    
                self.send_json(200, {"status": "success", "message": "Log updated"})
                print(f"[Log Received] Step: {payload.get('action', 'unknown')} | Result: {payload.get('status', 'ok')}")

            # 2. Read Local Workspace File
            elif parsed_path == "/workspace/read":
                rel_path = payload.get("path")
                if not rel_path:
                    self.send_json(400, {"status": "error", "message": "Missing 'path' parameter"})
                    return
                
                abs_path = resolve_workspace_path(rel_path)
                if abs_path is None:
                    self.send_json(403, {"status": "error", "message": "Access Denied: Path outside workspace root"})
                    return

                if not os.path.exists(abs_path):
                    self.send_json(444, {"status": "error", "message": "File not found"})
                    return

                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                self.send_json(200, {"status": "success", "content": content})

            # 3. Write/Modify Local Workspace File
            elif parsed_path == "/workspace/write":
                rel_path = payload.get("path")
                content = payload.get("content", "")
                if not rel_path:
                    self.send_json(400, {"status": "error", "message": "Missing 'path' parameter"})
                    return

                abs_path = resolve_workspace_path(rel_path)
                if abs_path is None:
                    self.send_json(403, {"status": "error", "message": "Access Denied: Path outside workspace root"})
                    return

                os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                with open(abs_path, "w", encoding="utf-8") as f:
                    f.write(content)

                self.send_json(200, {"status": "success", "message": "File written successfully"})

            # 4. Run Secure Local Script / Command
            elif parsed_path == "/workspace/run":
                command = payload.get("command")
                if not command:
                    self.send_json(400, {"status": "error", "message": "Missing 'command' parameter"})
                    return

                # Exclude dangerous operations to maintain a clean container state
                blacklist = ["rm -rf /", "format", "del /", "rd /"]
                if any(bad in command.lower() for bad in blacklist):
                    self.send_json(403, {"status": "error", "message": "Command execution blocked: unsafe instruction"})
                    return

                res = subprocess.run(command, shell=True, cwd=WORKSPACE_ROOT, capture_output=True, text=True, timeout=20)
                self.send_json(200, {
                    "status": "success",
                    "stdout": res.stdout,
                    "stderr": res.stderr,
                    "exit_code": res.returncode
                })

            # 5. Update/Sync Agent Sessions Database
            elif parsed_path == "/agent/session":
                sessions = payload.get("sessions", [])
                with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
                    json.dump({"sessions": sessions}, f, indent=2)
                self.send_json(200, {"status": "success", "message": "Sessions synchronized"})

            else:
                self.send_json(404, {"status": "error", "message": "Not Found"})

        except Exception as e:
            self.send_json(500, {"status": "error", "message": str(e)})

if __name__ == "__main__":
    print(f"Starting Local Multi-Threaded MonkeyPilot Server on http://localhost:{PORT} ...")
    server = ServerClass(("localhost", PORT), LogSyncHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down MonkeyPilot server.")
        server.shutdown()
