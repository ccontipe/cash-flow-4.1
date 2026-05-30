import { RegistrarLancamentoUseCase } from '../src/lancamentos/use-cases/registrar-lancamento.use-case';
import { LancamentoRepository } from '../src/lancamentos/repositories/lancamento.repository';
import { SqsPublisher } from '../src/lancamentos/repositories/sqs-publisher';
import { TipoLancamento, Lancamento } from '../src/lancamentos/entities/lancamento.entity';
import { CreateLancamentoDto } from '../src/lancamentos/dto/create-lancamento.dto';
import { QueryFailedError } from 'typeorm';

const makeLancamento = (overrides: Partial<Lancamento> = {}): Lancamento => ({
  id: 'uuid-1234',
  tipo: TipoLancamento.CREDITO,
  valor: 150.5,
  data: '2025-01-15',
  descricao: 'Venda',
  source: 'api',
  createdAt: new Date(),
  ...overrides,
});

describe('RegistrarLancamentoUseCase', () => {
  let useCase: RegistrarLancamentoUseCase;
  let repo: jest.Mocked<LancamentoRepository>;
  let publisher: jest.Mocked<SqsPublisher>;

  beforeEach(() => {
    repo = {
      findByIdempotencyKey: jest.fn(),
      createWithIdempotency: jest.fn(),
      findById: jest.fn(),
      findByData: jest.fn(),
    } as any;

    publisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;

    useCase = new RegistrarLancamentoUseCase(repo, publisher);
  });

  describe('Novo lançamento (chave inédita)', () => {
    it('deve persistir e publicar evento, retornando isIdempotentReplay=false', async () => {
      const dto: CreateLancamentoDto = {
        tipo: TipoLancamento.CREDITO,
        valor: 150.5,
        data: '2025-01-15',
        descricao: 'Venda',
      };
      const lancamento = makeLancamento();

      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.createWithIdempotency.mockResolvedValue(lancamento);

      const result = await useCase.execute(dto, 'key-new');

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.lancamento).toEqual(lancamento);
      expect(repo.createWithIdempotency).toHaveBeenCalledWith(dto, 'key-new');
      expect(publisher.publish).toHaveBeenCalledWith(lancamento);
    });
  });

  describe('Replay idempotente (chave existente)', () => {
    it('deve retornar o lançamento original sem persistir nem publicar', async () => {
      const existing = makeLancamento();
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      const result = await useCase.execute(
        { tipo: TipoLancamento.CREDITO, valor: 150.5, data: '2025-01-15' },
        'key-existing',
      );

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.lancamento).toEqual(existing);
      expect(repo.createWithIdempotency).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('Race condition: dois requests simultâneos com a mesma chave', () => {
    it('deve tratar QueryFailedError 23505 e retornar o lançamento existente', async () => {
      repo.findByIdempotencyKey
        .mockResolvedValueOnce(null)      // primeira verificação: não existe
        .mockResolvedValueOnce(makeLancamento()); // após a race: encontra

      const error = new QueryFailedError('INSERT', [], { code: '23505' } as any);
      repo.createWithIdempotency.mockRejectedValue(error);

      const result = await useCase.execute(
        { tipo: TipoLancamento.CREDITO, valor: 100, data: '2025-01-15' },
        'key-race',
      );

      expect(result.isIdempotentReplay).toBe(true);
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('Falha no SQS (circuit breaker)', () => {
    it('deve retornar lançamento mesmo quando SQS falha', async () => {
      const lancamento = makeLancamento();
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.createWithIdempotency.mockResolvedValue(lancamento);
      publisher.publish.mockRejectedValue(new Error('SQS unavailable'));

      // O circuit breaker dentro do SqsPublisher absorve o erro (Logger.error)
      // O use case não deve propagar a falha do SQS
      const result = await useCase.execute(
        { tipo: TipoLancamento.CREDITO, valor: 100, data: '2025-01-15' },
        'key-sqs-fail',
      );

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.lancamento).toEqual(lancamento);
    });
  });

  describe('Validação de domínio', () => {
    it('deve persistir lançamento de DEBITO corretamente', async () => {
      const lancamento = makeLancamento({ tipo: TipoLancamento.DEBITO, valor: 50 });
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.createWithIdempotency.mockResolvedValue(lancamento);

      const result = await useCase.execute(
        { tipo: TipoLancamento.DEBITO, valor: 50, data: '2025-01-15' },
        'key-debito',
      );

      expect(result.lancamento.tipo).toBe(TipoLancamento.DEBITO);
    });
  });
});
