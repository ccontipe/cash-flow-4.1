import { Controller, Get, Headers, BadRequestException } from '@nestjs/common';
import { LancamentoRepository } from './repositories/lancamento.repository';

/**
 * Rotas internas — sem JWT, consumidas apenas pelo svc-consolidado
 * durante a reconciliação. Em produção: proteger por IP allowlist ou
 * token de serviço (header x-internal-token).
 */
@Controller('internal/lancamentos')
export class LancamentosInternalController {
  constructor(private readonly repo: LancamentoRepository) {}

  /**
   * GET /internal/lancamentos?data=YYYY-MM-DD
   * Usado pelo ReconciliarSaldoUseCase no svc-consolidado.
   */
  @Get()
  async findByData(@Headers('x-data') data: string) {
    if (!data) {
      throw new BadRequestException('Header x-data (YYYY-MM-DD) é obrigatório');
    }
    const resumo = await this.repo.summarizeByData(data);
    return { statusCode: 200, data: resumo };
  }
}
