import { Controller, Get, Post, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ConsultarSaldoUseCase } from './use-cases/consultar-saldo.use-case';
import { ReconciliarSaldoUseCase } from './use-cases/reconciliar-saldo.use-case';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller()
export class ConsolidadoController {
  constructor(
    private readonly consultarSaldo: ConsultarSaldoUseCase,
    private readonly reconciliarSaldo: ReconciliarSaldoUseCase,
  ) {}

  /**
   * GET /saldo/:data
   * Retorna o saldo consolidado para uma data (YYYY-MM-DD).
   * Cache-aside Redis: TTL 24h dias passados / 60s dia corrente.
   */
  @UseGuards(JwtAuthGuard)
  @Get('saldo/:data')
  async getSaldo(@Param('data') data: string) {
    const saldo = await this.consultarSaldo.execute(data);
    return {
      statusCode: 200,
      data: {
        data: saldo.data,
        totalCreditos: Number(saldo.totalCreditos),
        totalDebitos: Number(saldo.totalDebitos),
        saldoFinal: Number(saldo.saldoFinal),
        updatedAt: saldo.updatedAt,
      },
    };
  }

  /**
   * POST /admin/reconciliar/:data
   * Reconcilia o saldo de uma data buscando lançamentos diretamente do svc-lancamentos.
   * Equivale ao job EventBridge Scheduler das 23h59 em produção.
   * Em dev local: use este endpoint para simular a reconciliação.
   *
   * Nota: em produção, proteger com IP allowlist ou token de serviço dedicado.
   */
  @Post('admin/reconciliar/:data')
  @HttpCode(HttpStatus.OK)
  async reconciliar(@Param('data') data: string) {
    const result = await this.reconciliarSaldo.execute(data);
    return {
      statusCode: 200,
      message: `Reconciliação concluída para ${data}`,
      data: result,
    };
  }
}
