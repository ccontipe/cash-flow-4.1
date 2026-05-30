-- =============================================================================
-- db-consolidado — Schema inicial
-- Executado automaticamente pelo docker-compose via volume mount no PostgreSQL.
-- Em produção AWS: executar via pipeline CI antes do deploy da aplicação.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabela de saldo diário consolidado
-- Atualizada incrementalmente pelo worker (UPSERT delta) e
-- sobrescrita pela reconciliação batch (UPSERT overwrite).
--
-- saldo_final é calculado pelo banco (GENERATED ALWAYS AS STORED):
-- garante que nunca haverá divergência entre total_creditos,
-- total_debitos e saldo_final — mesmo em updates diretos de banco.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saldo_diario (
    data            DATE           PRIMARY KEY,
    total_creditos  NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_creditos >= 0),
    total_debitos   NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_debitos >= 0),
    saldo_final     NUMERIC(15, 2) GENERATED ALWAYS AS (total_creditos - total_debitos) STORED,
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Tabela de controle de deduplicação do worker SQS
--
-- SQS Standard entrega at-least-once: o mesmo evento pode chegar mais
-- de uma vez (ex: falha antes do DeleteMessage, re-entrega após
-- Visibility Timeout). Sem controle de deduplicação, o mesmo lançamento
-- seria aplicado duas vezes ao saldo — resultado: saldo financeiro errado.
--
-- Solução: o worker insere o lancamento_id aqui na mesma transação que
-- aplica o delta em saldo_diario. UNIQUE em lancamento_id garante
-- exatamente um processamento por evento.
--
-- Race condition entre workers simultâneos → QueryFailedError 23505
-- → tratado no código como deduplicação silenciosa.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_processados (
    lancamento_id   UUID        PRIMARY KEY,  -- UNIQUE via PK
    event_type      VARCHAR(50) NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice por data de processamento para limpeza periódica (housekeeping)
CREATE INDEX IF NOT EXISTS idx_eventos_processed_at
    ON eventos_processados (processed_at);

DO $$
BEGIN
    RAISE NOTICE 'db-consolidado schema applied successfully at %', NOW();
END $$;
