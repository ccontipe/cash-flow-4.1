import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { SaldoDiarioRepository } from '../repositories/saldo-diario.repository';
import { CacheService } from '../repositories/cache.service';
import { SaldoDiario } from '../entities/saldo-diario.entity';

@Injectable()
export class ConsultarSaldoUseCase {
  private readonly logger = new Logger(ConsultarSaldoUseCase.name);

  constructor(
    private readonly repo: SaldoDiarioRepository,
    private readonly cache: CacheService,
  ) {}

  async execute(data: string): Promise<SaldoDiario> {
    // 1. Tenta o cache (cache-aside)
    const cached = await this.cache.get(data);
    if (cached) {
      this.logger.log(`Cache HIT for date ${data}`);
      return cached;
    }

    // 2. Fallback: banco
    this.logger.log(`Cache MISS for date ${data} — querying database`);
    const saldo = await this.repo.findByData(data);

    if (!saldo) {
      throw new NotFoundException(`Sem lançamentos consolidados para ${data}`);
    }

    // 3. Popula cache
    await this.cache.set(saldo);
    return saldo;
  }
}
