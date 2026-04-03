import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ModelConfig {
  provider: 'groq' | 'deepseek' | 'anthropic' | 'gemini' | 'openai';
  model: string;
  apiKey: string;
  apiKeys?: string[];
  maxTokens: number;
  temperature: number;
}

interface ProviderResponse {
  success: boolean;
  content?: string;
  provider?: string;
  model?: string;
  error?: string;
}

@Injectable()
export class LLMGatewayService {
  private primaryConfig!: ModelConfig;
  private fallbackConfigs: ModelConfig[] = [];
  private readonly _keyRotationIndex = 0; // reserved for future key rotation
  private circuitBreakers: Map<string, { failCount: number; openUntil: number }> =
    new Map();

  constructor() {
    this.initializeModels();
  }

  private initializeModels() {
    // Fallback 4: Gemini (Google)
    this.fallbackConfigs.push({
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY || '',
      apiKeys: this.parseApiKeys('GEMINI_API_KEYS', 'GEMINI_API_KEY'),
      maxTokens: 1024,
      temperature: 0.7,
    });

    // Primary: Groq (fast)
    this.primaryConfig = {
      provider: 'groq',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY || '',
      apiKeys: this.parseApiKeys('GROQ_API_KEYS', 'GROQ_API_KEY'),
      maxTokens: 2048,
      temperature: 0.3,
    };

    // Fallback 1: OpenAI
    this.fallbackConfigs.push({
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY || '',
      apiKeys: this.parseApiKeys('OPENAI_API_KEYS', 'OPENAI_API_KEY'),
      maxTokens: 2048,
      temperature: 0.3,
    });

    // Fallback 2: DeepSeek (cost-effective)
    this.fallbackConfigs.push({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      apiKeys: this.parseApiKeys('DEEPSEEK_API_KEYS', 'DEEPSEEK_API_KEY'),
      maxTokens: 1024,
      temperature: 0.7,
    });

    // Fallback 3: Anthropic (high quality)
    this.fallbackConfigs.push({
      provider: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      apiKeys: this.parseApiKeys('ANTHROPIC_API_KEYS', 'ANTHROPIC_API_KEY'),
      maxTokens: 2048,
      temperature: 0.7,
    });
  }

  /**
   * Main entry point - try primary, then fallback
   */
  async generateResponse(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      // Try primary model
      const result = await this.callModelWithRetry(this.primaryConfig, prompt, systemPrompt);
      if (result.success) {
        return result.content || '';
      }

      console.warn('⚠️ Primary model failed, trying fallback...');

      // Try fallback models in order
      for (const config of this.fallbackConfigs) {
        if (this.getConfigKeys(config).length === 0) continue; // Skip if no API key

        const fallbackResult = await this.callModelWithRetry(config, prompt, systemPrompt);
        if (fallbackResult.success) {
          console.log(`✅ Fallback model (${config.provider}) succeeded`);
          return fallbackResult.content || '';
        }
      }

      throw new Error('All LLM providers failed');
    } catch (error) {
      console.error('❌ LLM Gateway error:', (error as Error).message);
      throw new Error('LLM service unavailable: all providers failed');
    }
  }

  /**
   * Convenience method: chat with context (for backward compatibility with ChatService)
   */
  async chat(message: string, context?: string): Promise<string> {
    try {
      const plainTextInstruction =
        'Always respond with plain text, NO markdown, NO ** symbols, NO formatting codes.';
      const fullMessage = context
        ? `${plainTextInstruction}\n\nContext: ${context}\n\nUser: ${message}`
        : `${plainTextInstruction}\n\nUser: ${message}`;

      const response = await this.generateResponse(fullMessage);

      // Strip markdown if still present
      return response
        .replace(/\*\*/g, '')
        .replace(/^#+\s/gm, '')
        .replace(/^-\s/gm, '• ');
    } catch (error) {
      throw new Error(`Chat error: ${(error as Error).message}`);
    }
  }

  /**
   * Analyze data with question
   */
  async analyze(data: any, question: string): Promise<string> {
    const context = JSON.stringify(data, null, 2);
    return this.chat(question, context);
  }

  /**
   * Call model with circuit breaker and retry logic
   */
  private async callModelWithRetry(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
  ): Promise<ProviderResponse> {
    const keys = this.getConfigKeys(config);
    if (keys.length === 0) {
      return { success: false, error: 'No API key configured' };
    }

    let lastError = 'Unknown provider error';

    for (const key of keys) {
      const providerId = `${config.provider}:${config.model}:${this.getKeyFingerprint(key)}`;

      // Check circuit breaker per-key
      if (this.isCircuitOpen(providerId)) {
        console.warn(`⏸️ Circuit breaker open for ${providerId}`);
        lastError = 'Circuit breaker open';
        continue;
      }

      try {
        let response: string;

        if (config.provider === 'groq') {
          response = await this.callGroq(config, prompt, systemPrompt, key);
        } else if (config.provider === 'openai') {
          response = await this.callOpenAI(config, prompt, systemPrompt, key);
        } else if (config.provider === 'deepseek') {
          response = await this.callDeepSeek(config, prompt, systemPrompt, key);
        } else if (config.provider === 'anthropic') {
          response = await this.callAnthropic(config, prompt, systemPrompt, key);
        } else if (config.provider === 'gemini') {
          response = await this.callGemini(config, prompt, systemPrompt, key);
        } else {
          return { success: false, error: 'Unknown provider' };
        }

        // Reset circuit breaker on success
        this.circuitBreakers.delete(providerId);

        return {
          success: true,
          content: response,
          provider: config.provider,
          model: config.model,
        };
      } catch (error) {
        const handled = this.handleProviderError(providerId, error);
        lastError = handled.error || lastError;
        // Try next key/provider
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * OpenAI API call
   */
  private async callOpenAI(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
    apiKey?: string,
  ): Promise<string> {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.model,
        messages: [
          {
            role: 'system',
            content:
              systemPrompt ||
              'You are a helpful assistant. Always respond with plain text, NO markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey || config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    return response.data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Groq API call
   */
  private async callGroq(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
    apiKey?: string,
  ): Promise<string> {
    const client = new Groq({ apiKey: apiKey || config.apiKey });

    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt || 'You are a helpful assistant. Always respond with plain text, NO markdown, NO ** symbols.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * DeepSeek API call
   */
  private async callDeepSeek(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
    apiKey?: string,
  ): Promise<string> {
    const response = await axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: config.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt || 'You are a helpful assistant. Always respond with plain text, NO markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey || config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    return response.data.choices[0]?.message?.content || '';
  }

  /**
   * Anthropic API call (Claude)
   */
  private async callAnthropic(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
    apiKey?: string,
  ): Promise<string> {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: config.model,
        max_tokens: config.maxTokens,
        system: systemPrompt || 'You are a helpful assistant. Always respond with plain text, NO markdown.',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      },
      {
        headers: {
          'x-api-key': apiKey || config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30000,
      },
    );

    return response.data.content[0]?.text || '';
  }

  /**
   * Google Gemini API call
   */
  private async callGemini(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
    apiKey?: string,
  ): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey || config.apiKey);
    const model = genAI.getGenerativeModel({
      model: config.model,
      systemInstruction: systemPrompt || 'You are a helpful assistant. Always respond with plain text, NO markdown.',
      generationConfig: {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
      },
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  /**
   * Handle provider error and manage circuit breaker
   */
  private handleProviderError(providerId: string, error: unknown): ProviderResponse {
    const status = this.extractStatusCode(error);
    const message = this.extractErrorMessage(error);

    if (status === 429 || /rate\s*limit|quota|too\s*many\s*requests/i.test(message)) {
      console.error(`⚠️ Rate limit (429) for ${providerId}`);
      this.recordCircuitBreakerFailure(providerId, 60000); // 60s cooldown
      return { success: false, error: 'Rate limited' };
    }

    if (status === 401 || status === 403) {
      console.error(`⚠️ Auth error (${status}) for ${providerId}`);
      return { success: false, error: 'Authentication failed' };
    }

    if (status && status >= 500) {
      console.error(`⚠️ Server error (${status}) for ${providerId}`);
      this.recordCircuitBreakerFailure(providerId, 30000); // 30s cooldown
      return { success: false, error: 'Provider server error' };
    }

    console.error(`❌ Unknown error for ${providerId}:`, message);
    this.recordCircuitBreakerFailure(providerId, 10000); // 10s cooldown
    return { success: false, error: message };
  }

  /**
   * Circuit breaker: track failures per provider
   */
  private recordCircuitBreakerFailure(providerId: string, cooldownMs: number) {
    const current = this.circuitBreakers.get(providerId) || { failCount: 0, openUntil: 0 };
    current.failCount++;

    if (current.failCount >= 3) {
      current.openUntil = Date.now() + cooldownMs;
      console.log(`🔴 Circuit breaker opened for ${providerId} (${cooldownMs / 1000}s)`);
    }

    this.circuitBreakers.set(providerId, current);
  }

  private parseApiKeys(multiEnvName: string, singleEnvName: string): string[] {
    const multiRaw = process.env[multiEnvName] || '';
    const singleRaw = process.env[singleEnvName] || '';

    const keys = [
      ...multiRaw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      singleRaw.trim(),
    ].filter(Boolean);

    return Array.from(new Set(keys));
  }

  private getConfigKeys(config: ModelConfig): string[] {
    if (config.apiKeys && config.apiKeys.length > 0) return config.apiKeys;
    if (config.apiKey) return [config.apiKey];
    return [];
  }

  private getKeyFingerprint(apiKey: string): string {
    const clean = apiKey.trim();
    if (clean.length <= 8) return clean || 'no-key';
    return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
  }

  private extractStatusCode(error: unknown): number | undefined {
    const anyErr = error as any;
    return anyErr?.response?.status ?? anyErr?.status;
  }

  private extractErrorMessage(error: unknown): string {
    const anyErr = error as any;
    const msg =
      anyErr?.response?.data?.error?.message ||
      anyErr?.response?.data?.message ||
      anyErr?.message ||
      'Unknown provider error';
    return String(msg);
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(providerId: string): boolean {
    const breaker = this.circuitBreakers.get(providerId);
    if (!breaker) return false;

    if (Date.now() < breaker.openUntil) {
      return true; // Still open
    }

    // Half-open: try to recover
    this.circuitBreakers.delete(providerId);
    return false;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    primary: boolean;
    fallbacks: Array<{ provider: string; status: boolean }>;
  }> {
    const status = {
      primary: await this.checkProviderHealth(this.primaryConfig),
      fallbacks: [] as Array<{ provider: string; status: boolean }>,
    };

    for (const config of this.fallbackConfigs) {
      status.fallbacks.push({
        provider: config.provider,
        status: await this.checkProviderHealth(config),
      });
    }

    return status;
  }

  private async checkProviderHealth(config: ModelConfig): Promise<boolean> {
    try {
      const testPrompt = 'Respond with "ok"';
      const result = await this.callModelWithRetry(config, testPrompt);
      return result.success;
    } catch {
      return false;
    }
  }
}
