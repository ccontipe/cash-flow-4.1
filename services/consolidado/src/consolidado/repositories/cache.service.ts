import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { SaldoDiario } from '../entities/saldo-diario.entity';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisClientType;

  constructor() {
    this.client = createClient({
      socket: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }) as RedisClientType;

    this.client.on('error', (err) => this.logger.error(`Redis error: ${String(err)}`));
  }

  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (err) {
      this.logger.error(`Redis connect error: ${String(err)}`);
    }
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private buildKey(data: string): string {
    return `saldo:${data}`;
  }

  /**
   * TTL strategy:
   * - Dias passados: imutáveis → 86400s (24h)
   * - Dia corrente: mutável → 60s (invalidação por evento)
   */
  private ttlForDate(data: string): number {
    const today = new Date().toISOString().slice(0, 10);
    return data < today ? 86400 : 60;
  }

  async get(data: string): Promise<SaldoDiario | null> {
    try {
      const raw = await this.client.get(this.buildKey(data));
      if (!raw) return null;
      return JSON.parse(raw) as SaldoDiario;
    } catch (err) {
      this.logger.error(`Cache GET error for ${data}: ${String(err)}`);
      return null; // fallback para o banco
    }
  }

  async set(saldo: SaldoDiario): Promise<void> {
    try {
      await this.client.set(
        this.buildKey(saldo.data),
        JSON.stringify(saldo),
        { EX: this.ttlForDate(saldo.data) },
      );
    } catch (err) {
      this.logger.error(`Cache SET error: ${String(err)}`);
    }
  }

  async invalidate(data: string): Promise<void> {
    try {
      await this.client.del(this.buildKey(data));
      this.logger.log(`Cache invalidated for date ${data}`);
    } catch (err) {
      this.logger.error(`Cache DEL error: ${String(err)}`);
    }
  }
}
