import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';

@Injectable()
export class GroqService {
  private client: Groq;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not set in environment');
    }
    this.client = new Groq({ apiKey });
  }

  async chat(message: string, context?: string): Promise<string> {
    try {
      const fullMessage = context 
        ? `Context: ${context}\n\nUser: ${message}` 
        : message;

      const response = await this.client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'user',
            content: fullMessage,
          },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || 'No response';
    } catch (error) {
      throw new Error(`Groq error: ${error.message}`);
    }
  }

  async analyze(data: any, question: string): Promise<string> {
    const context = JSON.stringify(data, null, 2);
    return this.chat(question, context);
  }
}
