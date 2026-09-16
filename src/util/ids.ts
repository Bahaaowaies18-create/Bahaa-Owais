import { randomUUID } from "node:crypto";

function rand(): string {
  return randomUUID().replace(/-/g, "");
}

export function chatCompletionId(): string {
  return `chatcmpl-${rand().slice(0, 24)}`;
}

export function messageId(): string {
  return `msg_${rand().slice(0, 24)}`;
}

export function toolCallId(): string {
  return `call_${rand().slice(0, 24)}`;
}

export function requestId(): string {
  return `req_${rand().slice(0, 16)}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
