import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SaldoDiario } from '../entities/saldo-diario.entity';

export enum TipoLancamento {
  DEBITO = 'DEBITO',
  CREDITO = 'CREDITO',
}

@Injectable()
export class SaldoDiarioRepository {
  constructor(
    @InjectRepository(SaldoDiario)
    private readonly repo: Repository<SaldoDiario>,
    private readonly dataSource: DataSource,
  ) {}

  async findByData(data: string): Promise<SaldoDiario | null> {
    return this.repo.findOne({ where: { data } });
  }

  /**
   * Aplica delta de um lançamento ao saldo do dia e registra o evento
   * como processado — tudo em uma única transação.
   * Idempotente: a UNIQUE constraint em eventos_processados garante
   * que o mesmo lancamentoId só é aplicado uma vez, mesmo sob re-entrega.
   */
  async applyLancamento(
    data: string,
    tipo: TipoLancamento,
    valor: number,
    lancamentoId: string,
  ): Promise<void> {
    const creditoDelta = tipo === TipoLancamento.CREDITO ? valor : 0;
    const debitoDelta = tipo === TipoLancamento.DEBITO ? valor : 0;

    await this.dataSource.transaction(async (manager) => {
      // 1. Registra o evento como processado (UNIQUE constraint — falha se duplicado)
      await manager.query(
        `INSERT INTO eventos_processados (lancamento_id, event_type)
         VALUES ($1, $2)`,
        [lancamentoId, 'LancamentoRegistrado'],
      );

      // 2. Aplica o delta no saldo do dia
      await manager.query(
        `INSERT INTO saldo_diario (data, total_creditos, total_debitos)
         VALUES ($1, $2, $3)
         ON CONFLICT (data) DO UPDATE
         SET
           total_creditos = saldo_diario.total_creditos + EXCLUDED.total_creditos,
           total_debitos  = saldo_diario.total_debitos  + EXCLUDED.total_debitos,
           updated_at     = NOW()`,
        [data, creditoDelta, debitoDelta],
      );
    });
  }

  /**
   * Reconciliação: recalcula o saldo do dia do zero a partir dos totais fornecidos.
   * Usado pelo job de 23h59 (EventBridge) e pelo endpoint /admin/reconciliar/:data.
   * Sobrescreve qualquer estado anterior — operação idempotente.
   */
  async reconcile(
    data: string,
    totalCreditos: number,
    totalDebitos: number,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO saldo_diario (data, total_creditos, total_debitos)
       VALUES ($1, $2, $3)
       ON CONFLICT (data) DO UPDATE
       SET
         total_creditos = EXCLUDED.total_creditos,
         total_debitos  = EXCLUDED.total_debitos,
         updated_at     = NOW()`,
      [data, totalCreditos, totalDebitos],
    );
  }
}
