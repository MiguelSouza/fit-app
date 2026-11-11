-- O registro de acessos é append-only, e quem diz isso é o banco (card I-06).
--
-- Critério de aceite: "registros não podem ser editados nem apagados pela API".
-- O código já não tem caminho para isso — a porta `AccessLogRepository` só
-- oferece `append` e `findPage`, e não existe `update` nem `delete` desta
-- tabela em arquivo nenhum —, mas trilha de auditoria que depende de o código
-- se comportar é trilha que uma consulta distraída desfaz. Aqui a recusa é da
-- tabela, vale para qualquer conexão que use o papel da aplicação e não tem
-- como ser esquecida numa revisão.
--
-- Gatilho de statement e não de linha: assim `update ... where false` e
-- `delete` que não casa com nada também são recusados, em vez de passarem em
-- silêncio e darem a impressão de que a operação é permitida quando a cláusula
-- acerta alguma linha.
--
-- `truncate` tem gatilho próprio porque o Postgres não aceita o evento junto
-- dos outros dois.
--
-- Para apagar de verdade — retenção, direito de eliminação — é preciso ser dono
-- da tabela e derrubar os dois gatilhos numa migração revisada. É esse o
-- caminho, de propósito: é uma decisão de produto com card próprio, não um
-- `delete` de madrugada.
CREATE FUNCTION "identity"."access_log_is_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity.access_log is append-only: % is not allowed', tg_op
    USING errcode = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "access_log_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "identity"."access_log"
FOR EACH STATEMENT EXECUTE FUNCTION "identity"."access_log_is_append_only"();
--> statement-breakpoint
CREATE TRIGGER "access_log_no_truncate"
BEFORE TRUNCATE ON "identity"."access_log"
FOR EACH STATEMENT EXECUTE FUNCTION "identity"."access_log_is_append_only"();
