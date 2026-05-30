import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { LancamentoRepository } from '../repositories/lancamento.repository';
import { SqsPublisher } from '../repositories/sqs-publisher';
import { CreateLancamentoDto } from '../dto/create-lancamento.dto';
import { Lancamento } from '../entities/lancamento.entity';

export interface RegistrarLancamentoResult {
  lancamento: Lancamento;
  isIdempotentReplay: boolean;
}

@Injectable()
export class RegistrarLancamentoUseCase {
  private readonly logger = new Logger(RegistrarLancamentoUseCase.name);

  constructor(
    private readonly repo: LancamentoRepository,
    private readonly sqsPublisher: SqsPublisher,
  ) {}

  async execute(
    dto: CreateLancamentoDto,
    idempotencyKey: string,
  ): Promise<RegistrarLancamentoResult> {
    // 1. Verifica se a chave de idempotência já existe
    const existing = await this.repo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.logger.log(`Idempotent replay for key ${idempotencyKey}`);
      return { lancamento: existing, isIdempotentReplay: true };
    }

    // 2. Persiste lançamento + chave em transação atômica
    let lancamento: Lancamento;
    try {
      lancamento = await this.repo.createWithIdempotency(dto, idempotencyKey);
    } catch (err) {
      // Race condition: dois requests simultâneos com a mesma key.
      // A UNIQUE constraint do banco garante que apenas um vence.
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        const replay = await this.repo.findByIdempotencyKey(idempotencyKey);
        if (replay) {
          return { lancamento: replay, isIdempotentReplay: true };
        }
      }
      throw err;
    }

    // 3. Publica evento sem derrubar o lançamento se a fila falhar.
    try {
      await this.sqsPublisher.publish(lancamento);
    } catch (err) {
      this.logger.error(
        `Failed to publish event for lancamento ${lancamento.id}: ${String(err)}`,
      );
    }

    this.logger.log(`Lancamento ${lancamento.id} registered (${lancamento.tipo} R$${lancamento.valor})`);
    return { lancamento, isIdempotentReplay: false };
  }
}
