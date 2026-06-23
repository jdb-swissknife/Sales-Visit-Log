/**
 * Plaud MCP client. Spawns the @plaud-ai/mcp server as a subprocess and
 * communicates via JSON-RPC over stdio. Each rep has their own Plaud account,
 * so we spawn a separate server per rep with that rep's OAuth token.
 *
 * The MCP server exposes these tools:
 *   list_files   - list recordings (with date filters)
 *   get_file     - full details: presigned audio URL, transcript segments, AI notes
 *   get_transcript - full transcript with timestamps + speaker labels
 *   get_note     - AI summary, action items, key topics
 *
 * Auth: OAuth token stored at ~/.plaud/tokens-mcp.json after the initial
 * `npx -y @plaud-ai/mcp@latest install` browser flow. Per-rep accounts use
 * separate token directories via the PLAUD_TOKEN_DIR env var.
 */
import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaudRecording {
  id: string;
  name: string;
  created_at: string; // ISO 8601
  start_at?: string; // ISO 8601
  duration: number; // milliseconds
  serial_number: string;
}

export interface PlaudTranscriptSegment {
  speaker: string;
  start: number; // ms
  end: number; // ms
  text: string;
}

export interface PlaudFileDetail {
  id: string;
  name: string;
  created_at: string;
  start_at?: string;
  duration: number;
  serial_number: string;
  presigned_url?: string; // audio download (24hr)
  source_list?: PlaudTranscriptSegment[];
  note_list?: unknown[]; // AI notes in markdown
}

export interface PlaudNote {
  summary?: string;
  actionItems?: string[];
  topics?: string[];
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Low-level MCP client that manages the subprocess lifecycle and JSON-RPC
 * protocol. One instance per rep (each rep has their own token dir).
 */
export class PlaudMcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private buffer = "";
  private initialized = false;

  constructor(
    private readonly tokenDir: string,
    private readonly npxPath = "npx",
  ) {}

  /** Spawn the MCP server and perform the initialize handshake. */
  async start(): Promise<void> {
    if (this.proc) return;

    this.proc = spawn(this.npxPath, ["-y", "@plaud-ai/mcp@latest"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PLAUD_TOKEN_DIR: this.tokenDir,
      },
    });

    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr?.on("data", () => {}); // swallow noise
    this.proc.on("error", (err) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP process error: ${err.message}`));
      }
      this.pending.clear();
    });
    this.proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        for (const { reject } of this.pending.values()) {
          reject(new Error(`MCP process exited with code ${code}`));
        }
      }
      this.pending.clear();
      this.proc = null;
      this.initialized = false;
    });

    // MCP initialize handshake
    const result = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "svl-plaud-sync", version: "1.0.0" },
    });
    this.initialized = true;

    // Send initialized notification (no response expected)
    this.notify("notifications/initialized", {});
    void result; // handshake result acknowledged
  }

  /** Gracefully shut down the subprocess. */
  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.notify("shutdown", {});
    } catch {}
    this.proc.kill("SIGTERM");
    this.proc = null;
    this.initialized = false;
  }

  // ── Tool calls ──────────────────────────────────────────────────────────

  /** List recordings, optionally filtered by date range. */
  async listFiles(opts?: {
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;
    query?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PlaudRecording[]> {
    const args: Record<string, unknown> = {};
    if (opts?.dateFrom) args.date_from = opts.dateFrom;
    if (opts?.dateTo) args.dateTo = opts.dateTo;
    if (opts?.query) args.query = opts.query;
    if (opts?.page) args.page = opts.page;
    if (opts?.pageSize) args.page_size = opts.pageSize;

    const result = await this.callTool("list_files", args);
    return (result as PlaudRecording[]) ?? [];
  }

  /** Get full details for a single recording (transcript, notes, audio URL). */
  async getFile(id: string): Promise<PlaudFileDetail> {
    const result = await this.callTool("get_file", { id });
    return result as PlaudFileDetail;
  }

  /** Get the AI-generated note (summary, action items, topics). */
  async getNote(id: string): Promise<PlaudNote> {
    const result = await this.callTool("get_note", { id });
    return (result as PlaudNote) ?? {};
  }

  // ── Internal JSON-RPC ───────────────────────────────────────────────────

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    // MCP wraps tool results in { content: [{ type: "text", text: "..." }] }
    const wrapped = result as { content?: Array<{ type: string; text: string }> };
    if (wrapped?.content?.[0]?.text) {
      try {
        return JSON.parse(wrapped.content[0].text);
      } catch {
        return wrapped.content[0].text;
      }
    }
    return result;
  }

  private rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error("MCP process not running"));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.proc.stdin.write(JSON.stringify(msg) + "\n");

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP call timed out: ${method}`));
        }
      }, 30_000);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return;
    const msg = { jsonrpc: "2.0", method, params };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // keep incomplete last line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id != null && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(msg.error.message));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {
        // Not JSON or partial line -- ignore
      }
    }
  }
}
