# Documento de Defesa — Cash Flow 4.1
## Sistema de Fluxo de Caixa
### Controle de lançamentos e consolidado diário

---

## Abertura

Bom dia a todos.

Vou apresentar a defesa técnica da solução **Cash Flow 4.1**, desenvolvida para o desafio de arquitetura de um sistema de fluxo de caixa com controle de lançamentos de débito e crédito e consulta de saldo diário consolidado.

O objetivo desta solução é demonstrar como atender, de forma simples, resiliente e auditável, dois requisitos centrais:

- registrar lançamentos financeiros com segurança transacional;
- disponibilizar saldo diário consolidado sem acoplar o serviço de lançamentos ao serviço de consolidação.

O ponto mais importante da arquitetura é o isolamento de falhas. O serviço de lançamentos deve continuar operando mesmo que o consolidado esteja indisponível. Por isso, a solução adota comunicação assíncrona via SQS, separação entre escrita e leitura, idempotência no registro de lançamentos, deduplicação transacional no worker e reconciliação diária para fechamento de consistência.

A versão 4.1 também incorpora otimizações específicas: a reconciliação passou a buscar resumo agregado no banco de lançamentos, o worker removeu leitura prévia de deduplicação e o cache Redis passou a ser tratado no ciclo de vida do NestJS.

---

## 1. Contexto

O problema proposto é o controle de fluxo de caixa de um comerciante.

Na prática, o sistema precisa receber lançamentos de entrada e saída, persistir esses lançamentos de forma confiável e permitir a consulta do saldo consolidado por data.

O desafio não é apenas calcular créditos menos débitos. O desafio real está em preservar disponibilidade e consistência financeira em cenários de falha.

Os principais pontos de atenção são:

- não perder lançamentos;
- não duplicar lançamentos em caso de retry;
- não aplicar o mesmo evento duas vezes ao saldo consolidado;
- manter o serviço de lançamentos independente do consolidado;
- responder consultas de saldo com baixa latência;
- permitir correção do consolidado caso eventos assíncronos falhem.

A solução Cash Flow 4.1 resolve esses pontos separando claramente os domínios de escrita e leitura.

---

## 2. Riscos Identificados

A solução endereça cinco riscos principais.

O primeiro é o **risco de indisponibilidade em cascata**. Se o serviço de lançamentos chamasse o consolidado de forma síncrona, uma falha no consolidado impediria novos lançamentos. Isso violaria diretamente o requisito mais importante do desafio.

O segundo é o **risco de duplicidade no registro financeiro**. Um cliente pode repetir uma requisição por timeout, instabilidade de rede ou retry automático. Sem idempotência, o mesmo lançamento poderia ser persistido mais de uma vez.

O terceiro é o **risco de duplicidade no consolidado**. Como SQS Standard trabalha com entrega at-least-once, o mesmo evento pode chegar mais de uma vez ao worker. Sem deduplicação, o saldo diário poderia ser inflado ou reduzido incorretamente.

O quarto é o **risco de saldo desatualizado**. Em arquiteturas assíncronas, o consolidado é eventualmente consistente. A solução assume esse trade-off e adiciona reconciliação diária para garantir fechamento correto.

O quinto é o **risgo de gargalo em consultas de saldo**. O consolidado pode receber picos de leitura. Por isso, a solução usa cache Redis com estratégia cache-aside e invalidação por data.

---

## 3. Proposta de Solução

A solução é composta por dois serviços principais:

**`svc-lancamentos`**

Responsável por registrar lançamentos financeiros. Ele valida o DTO, exige uma `Idempotency-Key`, grava o lançamento e a chave de idempotência em transação única e publica o evento `LancamentoRegistrado` no SQS.

**`svc-consolidado`**

Responsável por consultar saldo diário, manter cache Redis, executar reconciliação manual ou agendada e hospedar o worker que processa eventos da fila.

A comunicação entre os domínios ocorre por SQS Standard:

```
POST /lancamentos
  → svc-lancamentos
  → RDS db-lancamentos
  → SQS Standard
  → worker-consolidado
  → RDS db-consolidado
  → DEL Redis saldo:{data}
```

Esse desenho garante que o serviço de lançamentos não depende da disponibilidade do consolidado para continuar funcionando.

---

## 4. Fluxo de Lançamento

O fluxo começa quando o comerciante registra um lançamento:

```
POST /lancamentos
Header: Idempotency-Key
Body: { tipo, valor, data, descricao }
```

O `svc-lancamentos` executa as seguintes etapas:

1. Verifica se a chave de idempotência já existe.
2. Se existir, retorna o lançamento original como replay idempotente.
3. Se não existir, abre transação.
4. Insere o lançamento na tabela `lancamentos`.
5. Insere a chave na tabela `idempotency_keys`.
6. Publica evento no SQS.
7. Retorna sucesso ao cliente.

A idempotência é garantida pelo banco, não por cache. A tabela `idempotency_keys` usa chave primária em `key`, garantindo consistência mesmo com múltiplas instâncias do serviço concorrendo.

Se dois requests simultâneos usarem a mesma chave, apenas um vence. O outro recebe erro de constraint `23505`, busca o lançamento já persistido e retorna como replay idempotente.

---

## 5. Fluxo de Consolidação

O worker do consolidado consome mensagens da fila SQS usando long polling.

Cada evento contém:

```
{
  eventType: "LancamentoRegistrado",
  lancamentoId,
  tipo,
  valor,
  data,
  occurredAt
}
```

Para aplicar o evento, o worker executa uma transação no banco `db-consolidado`:

1. Insere `lancamento_id` em `eventos_processados`.
2. Atualiza ou cria o saldo do dia em `saldo_diario`.
3. Confirma a transação.
4. Invalida o cache Redis da data.
5. Remove a mensagem da fila.

Na versão 4.1, a deduplicação foi otimizada. O worker não faz mais uma consulta prévia para saber se o evento já foi processado. Ele confia na constraint transacional da tabela `eventos_processados`.

Isso reduz uma query por mensagem e mantém a mesma garantia financeira: se o evento já foi processado, o `INSERT` falha com `23505`, a transação é revertida e a mensagem pode ser removida com segurança.

---

## 6. Fluxo de Consulta de Saldo

A consulta de saldo ocorre no `svc-consolidado`:

```
GET /saldo/:data
```

O serviço usa cache-aside com Redis:

1. Tenta buscar `saldo:{data}` no Redis.
2. Se houver cache hit, retorna imediatamente.
3. Se houver cache miss, consulta `saldo_diario` no PostgreSQL.
4. Grava o resultado no Redis com TTL.
5. Retorna o saldo ao cliente.

A estratégia de TTL é diferente por tipo de data:

- datas passadas: 24 horas;
- data corrente: 60 segundos, com invalidação ativa quando o worker processa novo evento.

Essa escolha equilibra desempenho e correção. Datas passadas tendem a ser estáveis, enquanto o dia corrente ainda recebe novos lançamentos.

---

## 7. Reconciliação

A reconciliação é o mecanismo de fechamento de consistência.

Ela existe porque há uma janela conhecida entre persistir o lançamento no banco e publicar o evento no SQS. Se o SQS estiver indisponível nesse intervalo, o lançamento fica correto no banco de origem, mas o evento pode não chegar ao consolidado.

A solução assume esse risco de forma explícita e o mitiga com reconciliação diária:

```
POST /admin/reconciliar/:data
```

Na versão 4.1, a reconciliação foi otimizada. O consolidado não busca mais todos os lançamentos do dia para somar em memória. Ele chama a rota interna:

```
GET /internal/lancamentos
Header: x-data
```

E o `svc-lancamentos` retorna um resumo agregado calculado no banco:

```
{
  totalCreditos,
  totalDebitos,
  lancamentosProcessados
}
```

Com isso, a reconciliação trafega menos dados, consome menos memória e escala melhor para dias com alto volume de lançamentos.

O consolidado então sobrescreve os totais do dia em `saldo_diario`. Não é delta. É recálculo total. Essa escolha torna a operação idempotente.

---

## 8. Banco de Dados

A solução usa dois bancos PostgreSQL separados:

**`db-lancamentos`**

Armazena:

- `lancamentos`;
- `idempotency_keys`.

**`db-consolidado`**

Armazena:

- `saldo_diario`;
- `eventos_processados`.

A separação segue o padrão database-per-service.

Essa decisão não é apenas organizacional. Ela reduz acoplamento entre domínios, permite evolução independente dos schemas e evita que carga de leitura do consolidado dispute recursos diretamente com a escrita de lançamentos.

As migrations são SQL explícitas, com `synchronize: false` em todos os ambientes. Isso evita drift de schema e torna o banco determinístico.

---

## 9. Decisões Arquiteturais Defendidas

### Por que SQS?

Porque o requisito principal é isolamento de falha. O serviço de lançamentos não pode depender do consolidado. SQS permite desacoplamento, retry automático, DLQ e absorção de indisponibilidade temporária do worker.

### Por que SQS Standard e não FIFO?

Porque ordenação global não é requisito. O saldo diário é atualizado por UPSERT e deduplicação transacional. FIFO adicionaria custo e limitação de throughput sem resolver um problema necessário neste cenário.

### Por que Redis?

Porque a consulta de saldo consolidado é naturalmente repetitiva. Muitos usuários podem consultar o mesmo dia, especialmente o dia corrente. Redis reduz pressão no banco e ajuda a atender o requisito de pico de leitura.

### Por que dois bancos?

Porque os domínios possuem cargas e responsabilidades diferentes. `db-lancamentos` protege o registro financeiro imutável. `db-consolidado` protege a projeção de leitura e pode ser recalculado. Separar os bancos reduz acoplamento e permite escala independente.

### Por que reconciliação se já existe SQS?

Porque SQS garante entrega depois que a mensagem entra na fila. Ele não elimina a janela entre `COMMIT` no banco e `SendMessage`. A reconciliação fecha esse gap operacional.

### Por que não implementar Outbox agora?

Outbox seria a evolução mais forte para eliminar a janela entre banco e fila. Mas para o escopo do desafio, a combinação de circuit breaker, DLQ e reconciliação diária é suficiente e mais simples. A solução documenta Outbox como evolução futura caso a consistência em tempo real se torne obrigatória.

---

## 10. Otimizações da Versão 4.1

A versão 4.1 melhorou a solução em quatro pontos:

1. **Reconciliação agregada no banco**

   A rota interna agora retorna `SUM/COUNT`, reduzindo tráfego e processamento em memória.

2. **Deduplicação transacional sem leitura prévia**

   O worker deixou de chamar `isEventoJaProcessado` antes de aplicar o lançamento. A própria constraint de `eventos_processados` é a fonte de verdade.

3. **Redis no ciclo de vida do NestJS**

   O cache agora conecta via `OnModuleInit`, com tratamento de erro para não derrubar o serviço se Redis estiver indisponível.

4. **Remoção de ordenação desnecessária**

   A consulta interna por data deixou de ordenar lançamentos quando a ordem não é usada para o cálculo.

Essas otimizações preservam o comportamento funcional e reduzem custo operacional em cenários de volume.

---

## 11. Segurança e Governança

A solução aplica controles compatíveis com um domínio financeiro:

- autenticação JWT nas rotas externas;
- DTOs validados com `class-validator`;
- queries parametrizadas via TypeORM;
- idempotência por constraint de banco;
- deduplicação por chave primária;
- lançamentos imutáveis;
- migrations explícitas;
- health checks por serviço;
- logs estruturados via interceptors.

O endpoint interno `/internal/lancamentos` não usa JWT no ambiente local, mas está documentado como rota interna. Em produção, deve ser protegido por rede privada, allowlist ou token de serviço.

---

## 12. Modos de Falha

### Consolidado fora do ar

Impacto em lançamentos: nenhum.

Os eventos permanecem no SQS. Quando o worker voltar, processa a fila.

### Redis fora do ar

Impacto em lançamentos: nenhum.

Impacto em consultas: maior latência, pois o serviço cai para o banco. O cache é otimização, não fonte de verdade.

### SQS indisponível no publish

Impacto imediato: lançamento persiste, evento pode não ser publicado.

Mitigação: reconciliação diária recalcula o saldo a partir do banco de lançamentos.

### Evento duplicado no SQS

Impacto: nenhum no saldo.

O `INSERT` em `eventos_processados` falha por chave primária, a transação não aplica delta e a mensagem é removida com segurança.

### Falha durante processamento do worker

Se a falha ocorrer antes do `DeleteMessage`, o SQS reentrega a mensagem após o visibility timeout. Como o processamento é deduplicado, a repetição é segura.

---

## 13. Validação Técnica

A solução Cash Flow 4.1 foi validada localmente com instalação de dependências, testes, typecheck e build nos dois serviços.

Resultados:

- `svc-lancamentos`: `npm test` passou, 5 testes.
- `svc-lancamentos`: `npm run typecheck` passou.
- `svc-lancamentos`: `npm run build` passou.
- `svc-consolidado`: `npm test` passou, 18 testes.
- `svc-consolidado`: `npm run typecheck` passou.
- `svc-consolidado`: `npm run build` passou.

Durante a validação, um ponto importante foi corrigido: o use case de registro de lançamentos passou a proteger também falhas lançadas pelo publisher injetado, garantindo que falha no SQS não derrube o lançamento já persistido.

Também foram adicionados os tipos de Express necessários para o TypeScript em modo estrito.

---

## 14. Fora do Escopo

Para manter a solução objetiva, alguns itens ficam fora do escopo desta versão:

- Outbox Pattern;
- multi-tenancy;
- conciliação bancária automática;
- UI administrativa;
- autorização por escopo granular;
- processamento automático da DLQ;
- deploy real em AWS via CDK;
- observabilidade completa com CloudWatch e X-Ray.

Esses itens estão previstos como evolução natural, mas não são necessários para demonstrar a arquitetura base do desafio.

---

## 15. Benefícios

A solução entrega benefícios diretos:

O **primeiro** é o isolamento de falhas. Lançamentos continuam funcionando mesmo que consolidado, Redis ou worker estejam indisponíveis.

O **segundo** é a segurança financeira. Idempotência e deduplicação são garantidas por constraints transacionais, não por mecanismos frágeis em memória.

O **terceiro** é a escalabilidade de leitura. Redis reduz a pressão sobre o banco do consolidado.

O **quarto** é a auditabilidade. Lançamentos são imutáveis e cada operação possui rastreabilidade por data, tipo e valor.

O **quinto** é a consistência operacional. A reconciliação diária corrige divergências causadas por falhas assíncronas.

O **sexto** é a simplicidade. A arquitetura usa componentes conhecidos, com baixo acoplamento e sem introduzir complexidade desnecessária como Kafka ou Kubernetes.

O **sétimo** é a evolução segura. Outbox, multi-tenancy e automação da DLQ podem ser adicionados sem invalidar a arquitetura atual.

---

## 16. Conclusão

O Cash Flow 4.1 é uma solução tecnicamente consistente para o desafio proposto.

Ela separa corretamente os domínios de lançamento e consolidação, protege o fluxo principal contra falhas em componentes secundários e usa mecanismos transacionais para preservar integridade financeira.

A decisão central é clara: o serviço de lançamentos não chama o consolidado de forma síncrona. Ele persiste o fato financeiro e publica um evento. O consolidado processa de forma assíncrona, cacheia leitura e é reconciliado no fechamento do dia.

Do ponto de vista arquitetural, a solução aplica CQRS, Event-Driven Architecture, database-per-service, cache-aside, idempotência transacional e reconciliação idempotente.

Do ponto de vista operacional, a versão 4.1 foi testada, compilada e ajustada com base nos resultados da validação.

A recomendação é defender a solução como uma arquitetura equilibrada: simples o suficiente para o escopo do desafio, mas robusta o suficiente para lidar com falhas reais de sistemas financeiros.

