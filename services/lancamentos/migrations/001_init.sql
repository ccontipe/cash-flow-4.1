-- =============================================================================
-- db-lancamentos — Schema inicial
-- Executado automaticamente pelo docker-compose via volume mount no PostgreSQL.
-- Em produção AWS: executar via pipeline CI antes do deploy da aplicação.
-- =============================================================================

-- Extensão para geração de UUID v4
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabela principal de lançamentos
-- Imutável por design: sem UPDATE/DELETE permitido via aplicação.
-- Estornos são novos lançamentos com tipo oposto.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lancamentos (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo        VARCHAR(7)  NOT NULL CHECK (tipo IN ('DEBITO', 'CREDITO')),
    valor       NUMERIC(15, 2) NOT NULL CHECK (valor > 0),
    data        DATE        NOT NULL,
    descricao   TEXT,
    source      VARCHAR(20) NOT NULL DEFAULT 'api',  -- 'api' | 'migrado'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Sem updated_at: lançamentos são imutáveis
);

-- Índice por data — acesso primário para reconciliação e relatórios
CREATE INDEX IF NOT EXISTS idx_lancamentos_data ON lancamentos (data);

-- Índice composto para relatórios por data + tipo
CREATE INDEX IF NOT EXISTS idx_lancamentos_data_tipo ON lancamentos (data, tipo);

-- ---------------------------------------------------------------------------
-- Tabela de controle de idempotência
-- UNIQUE em key garante exatamente uma inserção por operação do cliente.
-- Protege contra duplicatas em retry de rede ou re-envio acidental.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             VARCHAR(255) PRIMARY KEY,  -- UUID v4 gerado pelo cliente
    lancamento_id   UUID         NOT NULL REFERENCES lancamentos (id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Seed de verificação (removível em produção)
-- Confirma que o schema foi aplicado corretamente
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE 'db-lancamentos schema applied successfully at %', NOW();
END $$;
