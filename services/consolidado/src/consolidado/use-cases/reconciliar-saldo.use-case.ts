import { Injectable, Logger } from '@nestjs/common';
import { SaldoDiarioRepository } from '../repositories/saldo-diario.repository';
import { CacheService } from '../repositories/cache.service';

export interface ReconciliacaoResult {
  data: string;
  totalCreditos: number;
  totalDebitos: number;
  saldoFinal: number;
  lancamentosProcessados: number;
}

interface LancamentosResumoResponse {
  totalCreditos: number;
  totalDebitos: number;
  lancamentosProcessados: number;
}

@Injectable()
export class ReconciliarSaldoUseCase {
  private readonly logger = new Logger(ReconciliarSaldoUseCase.name);
  private readonly lancamentosServiceUrl: string;

  constructor(
    private readonly repo: SaldoDiarioRepository,
    private readonly cache: CacheService,
  ) {
    this.lancamentosServiceUrl =
      process.env.LANCAMENTOS_SERVICE_URL ?? 'http://localhost:3001';
  }

  /**
   * Reconcilia o saldo de uma data relendo os lançamentos diretamente
   * do svc-lancamentos e recalculando do zero.
   *
   * Garante consistência mesmo que eventos SQS tenham sido perdidos
   * (circuit breaker absorveu falha de publish, DLQ não processada, etc).
   *
   * Usado por:
   *   - EventBridge Scheduler (23h59 em produção AWS)
   *   - POST /admin/reconciliar/:data (trigger manual e dev local)
   */
  async execute(data: string): Promise<ReconciliacaoResult> {
    this.logger.log(`Starting reconciliation for date ${data}`);

    const resumo = await this.fetchLancamentosResumo(data);

    // Sobrescreve o saldo do dia — não é delta, é recálculo total
    await this.repo.reconcile(data, resumo.totalCreditos, resumo.totalDebitos);

    // Invalida cache para forçar leitura do banco na próxima consulta
    await this.cache.invalidate(data);

    const result: ReconciliacaoResult = {
      data,
      totalCreditos: resumo.totalCreditos,
      totalDebitos: resumo.totalDebitos,
      saldoFinal: resumo.totalCreditos - resumo.totalDebitos,
      lancamentosProcessados: resumo.lancamentosProcessados,
    };

    this.logger.log(
      `Reconciliation done for ${data}: ` +
        `${result.lancamentosProcessados} lancamentos, saldo=${result.saldoFinal}`,
    );

    return result;
  }

  private async fetchLancamentosResumo(
    data: string,
  ): Promise<LancamentosResumoResponse> {
    // Usa rota interna do svc-lancamentos — sem JWT, sem expor ao cliente
    const url = `${this.lancamentosServiceUrl}/internal/lancamentos`;

    const response = await fetch(url, {
      headers: { 'x-data': data },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch lancamentos for ${data}: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      data?: Partial<LancamentosResumoResponse>;
    };
    return {
      totalCreditos: Number(body.data?.totalCreditos ?? 0),
      totalDebitos: Number(body.data?.totalDebitos ?? 0),
      lancamentosProcessados: Number(body.data?.lancamentosProcessados ?? 0),
    };
  }
}
