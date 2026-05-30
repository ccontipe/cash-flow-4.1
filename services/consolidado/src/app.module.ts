import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { SaldoDiario } from './consolidado/entities/saldo-diario.entity';
import { EventoProcessado } from './consolidado/entities/evento-processado.entity';
import { SaldoDiarioRepository } from './consolidado/repositories/saldo-diario.repository';
import { CacheService } from './consolidado/repositories/cache.service';
import { ConsultarSaldoUseCase } from './consolidado/use-cases/consultar-saldo.use-case';
import { ReconciliarSaldoUseCase } from './consolidado/use-cases/reconciliar-saldo.use-case';
import { ConsolidadoController } from './consolidado/consolidado.controller';
import { SqsWorker } from './worker/sqs-worker.service';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'consolidado',
      username: process.env.DB_USER ?? 'consolidado',
      password: process.env.DB_PASS ?? 'consolidado',
      entities: [SaldoDiario, EventoProcessado],
      // synchronize: false em todos os ambientes.
      // Schema gerenciado por migrations SQL explícitas (migrations/001_init.sql).
      synchronize: false,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    TypeOrmModule.forFeature([SaldoDiario, EventoProcessado]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '15m' },
    }),
    HealthModule,
  ],
  controllers: [ConsolidadoController],
  providers: [
    SaldoDiarioRepository,
    CacheService,
    ConsultarSaldoUseCase,
    ReconciliarSaldoUseCase,
    SqsWorker,
  ],
})
export class AppModule {}
