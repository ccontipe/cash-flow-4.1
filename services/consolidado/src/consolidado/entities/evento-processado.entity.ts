import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Controle de deduplicação para o worker SQS.
 *
 * SQS Standard garante entrega at-least-once — o mesmo evento pode ser
 * entregue mais de uma vez (ex: falha antes do DeleteMessage, re-entrega
 * após Visibility Timeout). Para dados financeiros, processar o mesmo
 * lançamento duas vezes resultaria em saldo incorreto.
 *
 * Solução: inserir o lancamentoId na mesma transação que aplica o delta.
 * A UNIQUE constraint garante exatamente um processamento.
 */
@Entity('eventos_processados')
export class EventoProcessado {
  @PrimaryColumn({ type: 'uuid', name: 'lancamento_id' })
  lancamentoId: string;

  @Column({ type: 'varchar', length: 50, name: 'event_type' })
  eventType: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'processed_at' })
  processedAt: Date;
}
