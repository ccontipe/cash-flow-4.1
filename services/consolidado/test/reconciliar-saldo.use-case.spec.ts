import { ReconciliarSaldoUseCase } from '../src/consolidado/use-cases/reconciliar-saldo.use-case';
import { SaldoDiarioRepository } from '../src/consolidado/repositories/saldo-diario.repository';
import { CacheService } from '../src/consolidado/repositories/cache.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ReconciliarSaldoUseCase', () => {
  let useCase: ReconciliarSaldoUseCase;
  let repo: jest.Mocked<SaldoDiarioRepository>;
  let cache: jest.Mocked<CacheService>;

  beforeEach(() => {
    repo = {
      reconcile: jest.fn().mockResolvedValue(undefined),
      findByData: jest.fn(),
      applyLancamento: jest.fn(),
    } as any;

    cache = {
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;

    useCase = new ReconciliarSaldoUseCase(repo, cache);
    mockFetch.mockReset();
  });

  describe('Cálculo correto do saldo', () => {
    it('deve recalcular saldo somando todos os lançamentos da data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            totalCreditos: 700,
            totalDebitos: 150,
            lancamentosProcessados: 3,
          },
        }),
      });

      const result = await useCase.execute('2025-01-15');

      expect(result.totalCreditos).toBe(700);
      expect(result.totalDebitos).toBe(150);
      expect(result.saldoFinal).toBe(550);
      expect(result.lancamentosProcessados).toBe(3);
      expect(repo.reconcile).toHaveBeenCalledWith('2025-01-15', 700, 150);
      expect(cache.invalidate).toHaveBeenCalledWith('2025-01-15');
    });

    it('deve retornar zeros para data sem lançamentos', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            totalCreditos: 0,
            totalDebitos: 0,
            lancamentosProcessados: 0,
          },
        }),
      });

      const result = await useCase.execute('2025-01-01');

      expect(result.totalCreditos).toBe(0);
      expect(result.totalDebitos).toBe(0);
      expect(result.saldoFinal).toBe(0);
      expect(result.lancamentosProcessados).toBe(0);
      expect(repo.reconcile).toHaveBeenCalledWith('2025-01-01', 0, 0);
    });

    it('deve usar /internal/lancamentos e passar x-data no header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            totalCreditos: 100,
            totalDebitos: 0,
            lancamentosProcessados: 1,
          },
        }),
      });

      await useCase.execute('2025-06-01');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/internal/lancamentos'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-data': '2025-06-01' }),
        }),
      );
    });
  });

  describe('Resiliência', () => {
    it('deve lançar erro se svc-lancamentos retornar status != 200', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });

      await expect(useCase.execute('2025-01-15')).rejects.toThrow(
        'Failed to fetch lancamentos',
      );
      expect(repo.reconcile).not.toHaveBeenCalled();
    });

    it('deve lançar erro se svc-lancamentos estiver inacessível (ECONNREFUSED)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(useCase.execute('2025-01-15')).rejects.toThrow();
      expect(repo.reconcile).not.toHaveBeenCalled();
    });

    it('deve invalidar cache mesmo para datas retroativas', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            totalCreditos: 100,
            totalDebitos: 0,
            lancamentosProcessados: 1,
          },
        }),
      });

      await useCase.execute('2020-06-01');

      expect(cache.invalidate).toHaveBeenCalledWith('2020-06-01');
    });
  });
});
