# server.py - Lightweight CORS-Enabled Python Local Server for Agent Log Syncing
import http.server
import json
import os

PORT = 5000
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_test_logs.json")

class LogSyncHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        # Enable CORS preflight responses
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        
        # Return currently logged sessions
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, "r", encoding="utf-8") as f:
                self.wfile.write(f.read().encode("utf-8"))
        else:
            self.wfile.write(json.dumps({"status": "no logs logged yet"}).encode("utf-8"))

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        
        try:
            payload = json.loads(post_data.decode("utf-8"))
            
            # Read existing log history
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
            
            # Keep history under 100 entries to save space
            if len(history) > 100:
                history = history[-100:]
                
            with open(LOG_FILE, "w", encoding="utf-8") as f:
                json.dump(history, f, indent=2)
                
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "message": "Log updated"}).encode("utf-8"))
            print(f"[Log Received] Step: {payload.get('action', 'unknown')} | Result: {payload.get('status', 'ok')}")
        except Exception as e:
            self.send_response(500)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode("utf-8"))

if __name__ == "__main__":
    print(f"Starting Local Agent Logging Server on http://localhost:{PORT} ...")
    server = http.server.HTTPServer(("localhost", PORT), LogSyncHandler)
    server.serve_forever()
