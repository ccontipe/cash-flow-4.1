import { SqsWorker } from '../src/worker/sqs-worker.service';
import { SaldoDiarioRepository, TipoLancamento } from '../src/consolidado/repositories/saldo-diario.repository';
import { CacheService } from '../src/consolidado/repositories/cache.service';
import { QueryFailedError } from 'typeorm';

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  ReceiveMessageCommand: jest.fn(),
  DeleteMessageCommand: jest.fn(),
}));

describe('SqsWorker — processMessage', () => {
  let worker: SqsWorker;
  let repo: jest.Mocked<SaldoDiarioRepository>;
  let cache: jest.Mocked<CacheService>;
  let sqsSend: jest.Mock;

  const makeMessage = (body: object, receiptHandle = 'handle-1') => ({
    Body: JSON.stringify(body),
    ReceiptHandle: receiptHandle,
  });

  const validEvent = {
    eventType: 'LancamentoRegistrado',
    lancamentoId: 'uuid-1',
    tipo: TipoLancamento.CREDITO,
    valor: 250,
    data: '2025-01-15',
    occurredAt: new Date().toISOString(),
  };

  beforeEach(() => {
    repo = {
      applyLancamento: jest.fn().mockResolvedValue(undefined),
      findByData: jest.fn(),
      reconcile: jest.fn(),
    } as any;

    cache = {
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;

    worker = new SqsWorker(repo, cache);
    sqsSend = jest.fn().mockResolvedValue({});
    (worker as any).client = { send: sqsSend };
    (worker as any).isRunning = false;
  });

  describe('Processamento normal', () => {
    it('deve aplicar lançamento CREDITO, invalidar cache e deletar da fila', async () => {
      await (worker as any).processMessage(makeMessage(validEvent));

      expect(repo.applyLancamento).toHaveBeenCalledWith(
        '2025-01-15', TipoLancamento.CREDITO, 250, 'uuid-1',
      );
      expect(cache.invalidate).toHaveBeenCalledWith('2025-01-15');
      expect(sqsSend).toHaveBeenCalled(); // DeleteMessage
    });

    it('deve aplicar lançamento DEBITO corretamente', async () => {
      const event = { ...validEvent, tipo: TipoLancamento.DEBITO, valor: 100, lancamentoId: 'uuid-2' };
      await (worker as any).processMessage(makeMessage(event));

      expect(repo.applyLancamento).toHaveBeenCalledWith(
        '2025-01-15', TipoLancamento.DEBITO, 100, 'uuid-2',
      );
    });
  });

  describe('Deduplicação (SQS at-least-once)', () => {
    it('deve tratar evento duplicado pela constraint de deduplicação (QueryFailedError 23505)', async () => {
      const uniqueError = new QueryFailedError('INSERT', [], { code: '23505' } as any);
      repo.applyLancamento.mockRejectedValue(uniqueError);

      await (worker as any).processMessage(makeMessage(validEvent));

      expect(cache.invalidate).not.toHaveBeenCalled();
      expect(sqsSend).toHaveBeenCalled(); // DeleteMessage
    });
  });

  describe('Resiliência', () => {
    it('NÃO deve deletar a mensagem se o processamento falhar (re-entrega automática)', async () => {
      repo.applyLancamento.mockRejectedValue(new Error('DB connection lost'));

      await (worker as any).processMessage(makeMessage(validEvent));

      expect(sqsSend).not.toHaveBeenCalled(); // não deleta — SQS re-entrega
    });

    it('deve descartar e deletar eventos de tipo desconhecido', async () => {
      const unknown = { eventType: 'UnknownEvent', lancamentoId: 'x' };
      await (worker as any).processMessage(makeMessage(unknown));

      expect(repo.applyLancamento).not.toHaveBeenCalled();
      expect(sqsSend).toHaveBeenCalled(); // deleta para não re-entregar indefinidamente
    });

    it('deve ignorar mensagem sem Body', async () => {
      await (worker as any).processMessage({ Body: null, ReceiptHandle: null });
      expect(repo.applyLancamento).not.toHaveBeenCalled();
    });

    it('deve ignorar mensagem com JSON inválido sem crashar', async () => {
      const badMessage = { Body: 'not-json{{{', ReceiptHandle: 'handle-bad' };
      await expect(
        (worker as any).processMessage(badMessage),
      ).resolves.not.toThrow();
      expect(repo.applyLancamento).not.toHaveBeenCalled();
    });
  });
});
