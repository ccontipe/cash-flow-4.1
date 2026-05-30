import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { LancamentosModule } from './lancamentos/lancamentos.module';
import { HealthModule } from './health/health.module';
import { AuthController } from './auth/auth.controller';
import { Lancamento } from './lancamentos/entities/lancamento.entity';
import { IdempotencyKey } from './lancamentos/entities/idempotency-key.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'lancamentos',
      username: process.env.DB_USER ?? 'lancamentos',
      password: process.env.DB_PASS ?? 'lancamentos',
      entities: [Lancamento, IdempotencyKey],
      // synchronize: false em todos os ambientes.
      // Schema gerenciado por migrations SQL explícitas (migrations/001_init.sql).
      // Em dev local: aplicadas automaticamente pelo docker-compose via volume mount.
      // Em produção: aplicadas pelo pipeline CI antes do deploy.
      synchronize: false,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '15m' },
    }),
    LancamentosModule,
    HealthModule,
  ],
  controllers: [AuthController],
})
export class AppModule {}
