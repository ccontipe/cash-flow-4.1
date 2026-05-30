import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Lancamento } from '../entities/lancamento.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { CreateLancamentoDto } from '../dto/create-lancamento.dto';

export interface LancamentosPorDataResumo {
  totalCreditos: number;
  totalDebitos: number;
  lancamentosProcessados: number;
}

@Injectable()
export class LancamentoRepository {
  constructor(
    @InjectRepository(Lancamento)
    private readonly repo: Repository<Lancamento>,
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepo: Repository<IdempotencyKey>,
    private readonly dataSource: DataSource,
  ) {}

  async findByIdempotencyKey(key: string): Promise<Lancamento | null> {
    const ik = await this.idempotencyRepo.findOne({
      where: { key },
      relations: ['lancamento'],
    });
    return ik?.lancamento ?? null;
  }

  async findById(id: string): Promise<Lancamento | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByData(data: string): Promise<Lancamento[]> {
    return this.repo.find({ where: { data } });
  }

  async summarizeByData(data: string): Promise<LancamentosPorDataResumo> {
    const result = await this.repo
      .createQueryBuilder('l')
      .select(
        `COALESCE(SUM(CASE WHEN l.tipo = 'CREDITO' THEN l.valor ELSE 0 END), 0)`,
        'totalCreditos',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN l.tipo = 'DEBITO' THEN l.valor ELSE 0 END), 0)`,
        'totalDebitos',
      )
      .addSelect('COUNT(*)', 'lancamentosProcessados')
      .where('l.data = :data', { data })
      .getRawOne<{
        totalCreditos: string;
        totalDebitos: string;
        lancamentosProcessados: string;
      }>();

    return {
      totalCreditos: Number(result?.totalCreditos ?? 0),
      totalDebitos: Number(result?.totalDebitos ?? 0),
      lancamentosProcessados: Number(result?.lancamentosProcessados ?? 0),
    };
  }

  /**
   * Persiste o lançamento e a chave de idempotência em uma única transação ACID.
   * Se a idempotencyKey já existir (UNIQUE constraint), a transação falha —
   * o chamador deve tratar QueryFailedError (código 23505).
   */
  async createWithIdempotency(
    dto: CreateLancamentoDto,
    idempotencyKey: string,
  ): Promise<Lancamento> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const lancamento = manager.create(Lancamento, {
        tipo: dto.tipo,
        valor: dto.valor,
        data: dto.data,
        descricao: dto.descricao ?? null,
      });
      const saved = await manager.save(lancamento);

      const ik = manager.create(IdempotencyKey, {
        key: idempotencyKey,
        lancamentoId: saved.id,
      });
      await manager.save(ik);

      return saved;
    });
  }
}
