import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Lancamento } from '../entities/lancamento.entity';

export interface LancamentoRegistradoEvent {
  eventType: 'LancamentoRegistrado';
  lancamentoId: string;
  tipo: string;
  valor: number;
  data: string;
  occurredAt: string;
}

@Injectable()
export class SqsPublisher {
  private readonly logger = new Logger(SqsPublisher.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor() {
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'sa-east-1',
      ...(process.env.SQS_ENDPOINT
        ? { endpoint: process.env.SQS_ENDPOINT }
        : {}),
    });
    this.queueUrl = process.env.SQS_QUEUE_URL ?? '';
  }

  async publish(lancamento: Lancamento): Promise<void> {
    const event: LancamentoRegistradoEvent = {
      eventType: 'LancamentoRegistrado',
      lancamentoId: lancamento.id,
      tipo: lancamento.tipo,
      valor: Number(lancamento.valor),
      data: lancamento.data,
      occurredAt: new Date().toISOString(),
    };

    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(event),
          MessageAttributes: {
            eventType: {
              DataType: 'String',
              StringValue: 'LancamentoRegistrado',
            },
          },
        }),
      );
      this.logger.log(`Event published for lancamento ${lancamento.id}`);
    } catch (err) {
      // Circuit breaker simples: loga e não propaga.
      // O lançamento já foi persistido — a reconciliação batch de 23h59 cobre o gap.
      this.logger.error(
        `Failed to publish event for lancamento ${lancamento.id}: ${String(err)}`,
      );
    }
  }
}
