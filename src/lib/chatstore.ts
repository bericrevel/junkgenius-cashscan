// Chat history — on-device only, capped, clearable. Same privacy stance as
// everything else: conversations never leave the phone except as the API
// call that answers them.

import { getItem, setItem, removeItem } from "./storage";
import type { ChatMessage } from "./scout";

const KEY = "junkgenius:chat";
const MAX_STORED = 40;

export async function loadChat(): Promise<ChatMessage[]> {
  const raw = await getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  await setItem(KEY, JSON.stringify(messages.slice(-MAX_STORED)));
}

export async function clearChat(): Promise<void> {
  await removeItem(KEY);
}
