import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum TipoLancamento {
  DEBITO = 'DEBITO',
  CREDITO = 'CREDITO',
}

@Entity('lancamentos')
export class Lancamento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TipoLancamento })
  tipo: TipoLancamento;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  valor: number;

  @Index('idx_lancamentos_data')
  @Column({ type: 'date' })
  data: string; // ISO date string: YYYY-MM-DD

  @Column({ type: 'text', nullable: true })
  descricao: string | null;

  @Column({ type: 'varchar', length: 20, default: 'api' })
  source: string; // 'api' | 'migrado'

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
  // Sem @UpdateDateColumn — lançamentos são IMUTÁVEIS após criação
}
