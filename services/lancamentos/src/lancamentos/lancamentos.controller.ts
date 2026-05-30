import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { RegistrarLancamentoUseCase } from './use-cases/registrar-lancamento.use-case';
import { LancamentoRepository } from './repositories/lancamento.repository';
import { CreateLancamentoDto } from './dto/create-lancamento.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/**
 * Rotas protegidas por JWT — uso do comerciante
 */
@UseGuards(JwtAuthGuard)
@Controller('lancamentos')
export class LancamentosController {
  constructor(
    private readonly registrarUseCase: RegistrarLancamentoUseCase,
    private readonly repo: LancamentoRepository,
  ) {}

  /**
   * POST /lancamentos
   * Header obrigatório: Idempotency-Key (UUID v4 gerado pelo cliente)
   * 201 → novo lançamento | 200 → replay idempotente
   */
  @Post()
  async create(
    @Body() dto: CreateLancamentoDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key é obrigatório');
    }

    const { lancamento, isIdempotentReplay } =
      await this.registrarUseCase.execute(dto, idempotencyKey);

    return {
      statusCode: isIdempotentReplay ? HttpStatus.OK : HttpStatus.CREATED,
      data: {
        id: lancamento.id,
        tipo: lancamento.tipo,
        valor: Number(lancamento.valor),
        data: lancamento.data,
        descricao: lancamento.descricao,
        createdAt: lancamento.createdAt,
      },
      meta: { idempotentReplay: isIdempotentReplay },
    };
  }

  /**
   * GET /lancamentos/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const lancamento = await this.repo.findById(id);
    if (!lancamento) {
      throw new BadRequestException(`Lançamento ${id} não encontrado`);
    }
    return { statusCode: 200, data: lancamento };
  }
}
