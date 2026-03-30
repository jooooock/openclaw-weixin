export interface ChatMessage {
  id: number;
  fromUserId: string;
  toUserId: string;
  text: string;
  messageType: number; // 1=USER, 2=BOT
  createTimeMs: number;
}

export interface ChatUser {
  userId: string;
  lastMessageTime: number;
}
