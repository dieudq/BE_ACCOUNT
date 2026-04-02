import { Injectable } from '@nestjs/common';

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  intent?: string;
}

interface ConversationSession {
  userId: string;
  turns: ConversationTurn[];
  lastActiveAt: Date;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 phút không hoạt động thì xóa
const MAX_TURNS = 10; // Giữ tối đa 10 lượt gần nhất

/**
 * Lưu lịch sử hội thoại per-user trong memory.
 * Giúp agent hiểu context: "họ là ai?", "phiếu đó bao nhiêu tiền?", v.v.
 */
@Injectable()
export class ConversationContextService {
  private sessions = new Map<string, ConversationSession>();

  addTurn(userId: string, role: 'user' | 'assistant', content: string, intent?: string) {
    const session = this.getOrCreateSession(userId);
    session.turns.push({ role, content, timestamp: new Date(), intent });
    session.lastActiveAt = new Date();

    // Giữ tối đa MAX_TURNS lượt
    if (session.turns.length > MAX_TURNS) {
      session.turns = session.turns.slice(-MAX_TURNS);
    }
  }

  /**
   * Lấy context dạng string để đưa vào LLM prompt
   */
  getContextSummary(userId: string): string[] {
    const session = this.sessions.get(userId);
    if (!session || session.turns.length === 0) return [];

    return session.turns.map(
      (t) => `${t.role === 'user' ? 'Người dùng' : 'Bot'}: ${t.content}`,
    );
  }

  /**
   * Lấy intent của lượt trước để resolve pronouns ("họ", "phiếu đó", "nó")
   */
  getLastIntent(userId: string): string | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    const lastUserTurn = [...session.turns].reverse().find((t) => t.role === 'user');
    return lastUserTurn?.intent;
  }

  /**
   * Lấy entities từ lượt trước (để kế thừa context)
   */
  getLastUserMessage(userId: string): string | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    return [...session.turns].reverse().find((t) => t.role === 'user')?.content;
  }

  clearSession(userId: string) {
    this.sessions.delete(userId);
  }

  private getOrCreateSession(userId: string): ConversationSession {
    const existing = this.sessions.get(userId);
    if (existing) {
      // Kiểm tra TTL
      if (Date.now() - existing.lastActiveAt.getTime() > SESSION_TTL_MS) {
        this.sessions.delete(userId);
      } else {
        return existing;
      }
    }

    const session: ConversationSession = {
      userId,
      turns: [],
      lastActiveAt: new Date(),
    };
    this.sessions.set(userId, session);
    return session;
  }
}
