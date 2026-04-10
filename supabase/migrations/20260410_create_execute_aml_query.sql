DROP FUNCTION IF EXISTS public.execute_aml_query(text);

CREATE FUNCTION public.execute_aml_query(sql_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed_sql text;
  normalized_sql text;
  result jsonb;
BEGIN
  IF sql_text IS NULL OR btrim(sql_text) = '' THEN
    RAISE EXCEPTION 'SQL 不能为空';
  END IF;

  trimmed_sql := btrim(sql_text);

  normalized_sql := lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(sql_text, E'/\\*.*?\\*/', ' ', 'gs'),
        E'--[^\\n\\r]*',
        ' ',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  );

  IF trimmed_sql !~* '^(select|with)\y' THEN
    RAISE EXCEPTION '仅允许 SELECT 查询';
  END IF;

  IF normalized_sql ~* '(pg_|information_schema|current_setting|set_config)' THEN
    RAISE EXCEPTION '检测到系统表或敏感配置访问';
  END IF;

  IF normalized_sql ~* E'\\y(drop|delete|update|insert|truncate|alter|grant|revoke|create|comment)\\y' THEN
    RAISE EXCEPTION '检测到危险 SQL 关键字';
  END IF;

  EXECUTE
    'SELECT COALESCE(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM (' || sql_text || ') AS q'
  INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.execute_aml_query(text)
IS '执行只读 AML SQL，并以 JSONB 数组返回结果。';
