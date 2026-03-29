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
      const plainTextInstruction = 'Always respond with plain text, NO markdown, NO ** symbols, NO formatting codes.';
      const fullMessage = context 
        ? `${plainTextInstruction}\n\nContext: ${context}\n\nUser: ${message}` 
        : `${plainTextInstruction}\n\nUser: ${message}`;

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

      const content = response.choices[0]?.message?.content || 'No response';
      
      // Strip markdown if Groq still returns it
      return content
        .replace(/\*\*/g, '')
        .replace(/\*\*/g, '')
        .replace(/^#+\s/gm, '')
        .replace(/^-\s/gm, '• ');
    } catch (error) {
      throw new Error(`Groq error: ${error.message}`);
    }
  }

  async analyze(data: any, question: string): Promise<string> {
    const context = JSON.stringify(data, null, 2);
    return this.chat(question, context);
  }
}
