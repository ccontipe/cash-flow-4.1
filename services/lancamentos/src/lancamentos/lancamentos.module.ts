import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LancamentosController } from './lancamentos.controller';
import { LancamentosInternalController } from './lancamentos-internal.controller';
import { LancamentoRepository } from './repositories/lancamento.repository';
import { SqsPublisher } from './repositories/sqs-publisher';
import { RegistrarLancamentoUseCase } from './use-cases/registrar-lancamento.use-case';
import { Lancamento } from './entities/lancamento.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Lancamento, IdempotencyKey])],
  controllers: [LancamentosController, LancamentosInternalController],
  providers: [LancamentoRepository, SqsPublisher, RegistrarLancamentoUseCase],
})
export class LancamentosModule {}
