import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import axios, { AxiosError } from 'axios';

interface ModelConfig {
  provider: 'groq' | 'deepseek' | 'anthropic';
  model: string;
  apiKey: string;
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
  private primaryConfig: ModelConfig;
  private fallbackConfigs: ModelConfig[] = [];
  private keyRotationIndex = 0;
  private circuitBreakers: Map<string, { failCount: number; openUntil: number }> =
    new Map();

  constructor() {
    this.initializeModels();
  }

  private initializeModels() {
    // Primary: Groq (fast)
    this.primaryConfig = {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY || '',
      maxTokens: 1024,
      temperature: 0.7,
    };

    // Fallback 1: DeepSeek (cost-effective)
    this.fallbackConfigs.push({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      maxTokens: 1024,
      temperature: 0.7,
    });

    // Fallback 2: Anthropic (high quality)
    this.fallbackConfigs.push({
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      maxTokens: 1024,
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
        if (!config.apiKey) continue; // Skip if no API key

        const fallbackResult = await this.callModelWithRetry(config, prompt, systemPrompt);
        if (fallbackResult.success) {
          console.log(`✅ Fallback model (${config.provider}) succeeded`);
          return fallbackResult.content || '';
        }
      }

      throw new Error('All LLM providers failed');
    } catch (error) {
      console.error('❌ LLM Gateway error:', error.message);
      return 'Service temporarily unavailable. Please try again later.';
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
      throw new Error(`Chat error: ${error.message}`);
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
    const providerId = `${config.provider}:${config.model}`;

    // Check circuit breaker
    if (this.isCircuitOpen(providerId)) {
      console.warn(`⏸️ Circuit breaker open for ${providerId}`);
      return { success: false, error: 'Circuit breaker open' };
    }

    try {
      let response: string;

      if (config.provider === 'groq') {
        response = await this.callGroq(config, prompt, systemPrompt);
      } else if (config.provider === 'deepseek') {
        response = await this.callDeepSeek(config, prompt, systemPrompt);
      } else if (config.provider === 'anthropic') {
        response = await this.callAnthropic(config, prompt, systemPrompt);
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
      return this.handleProviderError(providerId, error as AxiosError);
    }
  }

  /**
   * Groq API call
   */
  private async callGroq(
    config: ModelConfig,
    prompt: string,
    systemPrompt?: string,
  ): Promise<string> {
    const client = new Groq({ apiKey: config.apiKey });

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
          'Authorization': `Bearer ${config.apiKey}`,
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
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30000,
      },
    );

    return response.data.content[0]?.text || '';
  }

  /**
   * Handle provider error and manage circuit breaker
   */
  private handleProviderError(providerId: string, error: AxiosError): ProviderResponse {
    const status = error.response?.status;

    if (status === 429) {
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

    console.error(`❌ Unknown error for ${providerId}:`, error.message);
    this.recordCircuitBreakerFailure(providerId, 10000); // 10s cooldown
    return { success: false, error: error.message };
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
