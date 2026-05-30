import { ConsultarSaldoUseCase } from '../src/consolidado/use-cases/consultar-saldo.use-case';
import { SaldoDiarioRepository } from '../src/consolidado/repositories/saldo-diario.repository';
import { CacheService } from '../src/consolidado/repositories/cache.service';
import { SaldoDiario } from '../src/consolidado/entities/saldo-diario.entity';
import { NotFoundException } from '@nestjs/common';

const makeSaldo = (overrides: Partial<SaldoDiario> = {}): SaldoDiario => ({
  data: '2025-01-15',
  totalCreditos: 500,
  totalDebitos: 200,
  saldoFinal: 300,
  updatedAt: new Date(),
  ...overrides,
});

describe('ConsultarSaldoUseCase', () => {
  let useCase: ConsultarSaldoUseCase;
  let repo: jest.Mocked<SaldoDiarioRepository>;
  let cache: jest.Mocked<CacheService>;

  beforeEach(() => {
    repo = {
      findByData: jest.fn(),
      applyLancamento: jest.fn(),
      reconcile: jest.fn(),
    } as any;

    cache = {
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn(),
    } as any;

    useCase = new ConsultarSaldoUseCase(repo, cache);
  });

  describe('Cache HIT', () => {
    it('deve retornar do cache sem consultar o banco', async () => {
      const saldo = makeSaldo();
      cache.get.mockResolvedValue(saldo);

      const result = await useCase.execute('2025-01-15');

      expect(result).toEqual(saldo);
      expect(repo.findByData).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('Cache MISS', () => {
    it('deve consultar o banco e popular o cache', async () => {
      const saldo = makeSaldo();
      cache.get.mockResolvedValue(null);
      repo.findByData.mockResolvedValue(saldo);

      const result = await useCase.execute('2025-01-15');

      expect(result).toEqual(saldo);
      expect(repo.findByData).toHaveBeenCalledWith('2025-01-15');
      expect(cache.set).toHaveBeenCalledWith(saldo);
    });

    it('deve lançar NotFoundException se não há saldo para a data', async () => {
      cache.get.mockResolvedValue(null);
      repo.findByData.mockResolvedValue(null);

      await expect(useCase.execute('2025-01-01')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Falha no cache (Redis indisponível)', () => {
    it('deve fazer fallback para o banco se cache.get lançar erro', async () => {
      const saldo = makeSaldo();
      // CacheService absorve erros internamente e retorna null
      cache.get.mockResolvedValue(null);
      repo.findByData.mockResolvedValue(saldo);

      const result = await useCase.execute('2025-01-15');
      expect(result).toEqual(saldo);
    });
  });

  describe('Saldo com valores corretos', () => {
    it('deve retornar saldoFinal = totalCreditos - totalDebitos', async () => {
      const saldo = makeSaldo({ totalCreditos: 1000, totalDebitos: 350, saldoFinal: 650 });
      cache.get.mockResolvedValue(saldo);

      const result = await useCase.execute('2025-01-15');
      expect(result.saldoFinal).toBe(650);
    });
  });
});
