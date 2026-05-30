import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { QueryFailedError } from 'typeorm';
import { SaldoDiarioRepository, TipoLancamento } from '../consolidado/repositories/saldo-diario.repository';
import { CacheService } from '../consolidado/repositories/cache.service';

export interface LancamentoRegistradoEvent {
  eventType: string;
  lancamentoId: string;
  tipo: TipoLancamento;
  valor: number;
  data: string;
  occurredAt: string;
}

@Injectable()
export class SqsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsWorker.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private isRunning = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly saldoRepo: SaldoDiarioRepository,
    private readonly cache: CacheService,
  ) {
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'sa-east-1',
      ...(process.env.SQS_ENDPOINT ? { endpoint: process.env.SQS_ENDPOINT } : {}),
    });
    this.queueUrl = process.env.SQS_QUEUE_URL ?? '';
  }

  onModuleInit() {
    this.isRunning = true;
    this.logger.log('SQS Worker started — polling for messages');
    void this.poll();
  }

  onModuleDestroy() {
    this.isRunning = false;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    this.logger.log('SQS Worker stopped');
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20, // long polling
          VisibilityTimeout: 30,
        }),
      );

      const messages = response.Messages ?? [];
      await Promise.all(messages.map((msg) => this.processMessage(msg)));
    } catch (err) {
      this.logger.error(`Poll error: ${String(err)}`);
    }

    if (this.isRunning) {
      this.pollTimeout = setTimeout(() => void this.poll(), 100);
    }
  }

  async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;

    let event: LancamentoRegistradoEvent;
    try {
      event = JSON.parse(message.Body) as LancamentoRegistradoEvent;
    } catch {
      this.logger.error('Failed to parse message body — sending to DLQ via non-delete');
      return; // não deleta → vai para DLQ após maxReceiveCount
    }

    if (event.eventType !== 'LancamentoRegistrado') {
      this.logger.warn(`Unknown event type: ${event.eventType} — discarding`);
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    try {
      // applyLancamento usa transação: registra evento + aplica delta atomicamente
      // Se o INSERT em eventos_processados falhar por UNIQUE constraint,
      // a transação faz rollback e o lançamento não é aplicado duas vezes.
      await this.saldoRepo.applyLancamento(
        event.data,
        event.tipo,
        event.valor,
        event.lancamentoId,
      );

      await this.cache.invalidate(event.data);

      this.logger.log(
        `Processed ${event.tipo} R$${event.valor} for ${event.data} (id: ${event.lancamentoId})`,
      );

      // ACK: deleta SOMENTE após processamento bem-sucedido
      await this.deleteMessage(message.ReceiptHandle);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        this.logger.warn(`Duplicate event for lancamento ${event.lancamentoId} — safe to delete`);
        await this.deleteMessage(message.ReceiptHandle);
        return;
      }
      // Qualquer outro erro: NÃO deleta → SQS re-entrega após Visibility Timeout
      // Após maxReceiveCount=3 tentativas → DLQ automaticamente
      this.logger.error(`Failed to process lancamento ${event.lancamentoId}: ${String(err)}`);
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
