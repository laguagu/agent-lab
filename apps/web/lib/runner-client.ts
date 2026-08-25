"use client";

/**
 * Duplex connection to the orchestrator.
 *
 * Why a WebSocket rather than the AI SDK's useChat: one channel carries the prompt, the
 * permission reply, the file operation and the terminal keystroke. useChat's SSE protocol
 * is half-duplex and cannot carry them without a second channel.
 *
 * `since` enables reconnects: the orchestrator replays whatever was missed from its buffer.
 */

import type { RunnerCommand, RunnerEvent } from "@skill-lab/protocol";

export type RunnerClientOptions = {
  sessionId: string;
  baseWs?: string;
  onEvent: (ev: RunnerEvent) => void;
  onStatus?: (status: "connecting" | "open" | "closed") => void;
};

export class RunnerClient {
  #ws: WebSocket | null = null;
  #opts: RunnerClientOptions;
  #lastSeq = -1;
  #closedByUs = false;
  #retry = 0;
  #pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(opts: RunnerClientOptions) {
    this.#opts = opts;
  }

  connect() {
    this.#closedByUs = false;
    this.#open();
  }

  #open() {
    const base =
      this.#opts.baseWs ??
      process.env.NEXT_PUBLIC_ORCHESTRATOR_WS ??
      "ws://localhost:8080";
    const url = `${base}/ws/client?session=${encodeURIComponent(this.#opts.sessionId)}&since=${this.#lastSeq}`;

    this.#opts.onStatus?.("connecting");
    const ws = new WebSocket(url);
    this.#ws = ws;

    ws.onopen = () => {
      this.#retry = 0;
      this.#opts.onStatus?.("open");
    };

    ws.onmessage = (e) => {
      let ev: RunnerEvent;
      try {
        ev = JSON.parse(e.data as string) as RunnerEvent;
      } catch {
        return;
      }
      if (ev.seq > this.#lastSeq) this.#lastSeq = ev.seq;

      // Request/response pairs are settled before anything reaches the reducer.
      if (ev.type === "result") {
        const waiter = this.#pendingRequests.get(ev.requestId);
        if (waiter) {
          this.#pendingRequests.delete(ev.requestId);
          if (ev.ok) waiter.resolve(ev.data);
          else waiter.reject(new Error(ev.error?.message ?? "unknown error"));
          return;
        }
      }

      this.#opts.onEvent(ev);
    };

    ws.onclose = () => {
      this.#opts.onStatus?.("closed");
      if (this.#closedByUs) return;
      // Exponential backoff, capped at 10 s.
      const delay = Math.min(10_000, 500 * 2 ** this.#retry++);
      setTimeout(() => this.#open(), delay);
    };

    ws.onerror = () => ws.close();
  }

  send(cmd: RunnerCommand) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(cmd));
    }
  }

  /** A command that waits for a `result` event with the same requestId. */
  request<T>(cmd: Omit<RunnerCommand, "requestId"> & { type: string }): Promise<T> {
    const requestId = crypto.randomUUID().slice(0, 8);
    return new Promise<T>((resolve, reject) => {
      this.#pendingRequests.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      setTimeout(() => {
        if (this.#pendingRequests.delete(requestId)) {
          reject(new Error("aikakatkaisu"));
        }
      }, 20_000);
      this.send({ ...cmd, requestId } as unknown as RunnerCommand);
    });
  }

  close() {
    this.#closedByUs = true;
    this.#ws?.close();
  }
}
