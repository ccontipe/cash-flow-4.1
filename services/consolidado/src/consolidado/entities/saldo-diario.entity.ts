import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('saldo_diario')
export class SaldoDiario {
  @PrimaryColumn({ type: 'date' })
  data: string; // YYYY-MM-DD

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, name: 'total_creditos' })
  totalCreditos: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, name: 'total_debitos' })
  totalDebitos: number;

  // Gerado pelo banco: total_creditos - total_debitos
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    generatedType: 'STORED',
    asExpression: 'total_creditos - total_debitos',
    name: 'saldo_final',
    insert: false,
    update: false,
  })
  saldoFinal: number;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
