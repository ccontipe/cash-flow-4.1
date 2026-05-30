import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Lancamento } from './lancamento.entity';

@Entity('idempotency_keys')
export class IdempotencyKey {
  // UNIQUE constraint via PrimaryColumn — garante exatamente uma inserção
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'uuid', name: 'lancamento_id' })
  lancamentoId: string;

  @ManyToOne(() => Lancamento)
  @JoinColumn({ name: 'lancamento_id' })
  lancamento: Lancamento;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
