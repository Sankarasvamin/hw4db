export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRow = Record<string, JsonValue>;

export interface AskApiResponse {
  question: string;
  sql: string;
  rows: JsonRow[];
  rowCount: number;
  summary: string;
  model: string;
}

const SQL_BLOCKLIST =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|execute|copy|merge|vacuum|analyze|refresh|call|do)\b/i;

const AML_VIEW_SCHEMA = `
视图: public.v_aml_intelligence_hub
核心字段:
- transaction_id, reference_code, transaction_type, transaction_status
- amount, currency, exchange_rate, amount_usd, amount_usd_rounded
- created_at, txn_date, txn_time, txn_unix_ts, txn_day_of_week, txn_hour, txn_time_band, completed_at, processing_seconds
- sender_account_id, sender_account_number, sender_user_id, sender_name, sender_nationality, sender_risk_level, sender_risk_score, sender_balance, sender_account_status, sender_branch, sender_is_pep, sender_is_sanctioned, sender_kyc_passed
- receiver_account_id, receiver_account_number, receiver_user_id, receiver_name, receiver_nationality, receiver_risk_level, receiver_balance, receiver_account_status, receiver_is_pep, receiver_is_sanctioned
- geo_country, geo_lat, geo_lng, ip_address, device_id
- is_flagged, alert_id, alert_status, triggered_rule_code, triggered_rule_name, rule_description, rule_category, rule_severity, rule_threshold_amount, threshold_breach_ratio
- ai_money_laundering_prob, ai_risk_band, composite_risk_score, investigation_notes, alert_triggered_at
`;

export const AML_SQL_SYSTEM_PROMPT = `
你是 AML SQL 生成器，只负责把自然语言转成 PostgreSQL 查询。
你只能查询 ${AML_VIEW_SCHEMA}

硬性约束:
1. 只能生成 SELECT 或 WITH ... SELECT 语句。
2. 目标对象只能是 v_aml_intelligence_hub。
3. 最终 SQL 必须包含 LIMIT 50。
4. 若 SQL 使用 ai_money_laundering_prob，必须在 SQL 注释中出现 $\\mathbb{P}$。
5. 若 SQL 使用 AVG(...) 估计均值/期望，必须在 SQL 注释中出现 $\\mathbb{E}$。
6. 不要生成 INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE、GRANT、REVOKE、CREATE。
7. 优先输出与时间、金额、风险等级、规则严重度、概率评分相关的可解释查询。
8. 返回严格 JSON，格式为 {"sql":"...","summary":"..."}，禁止 Markdown 代码块。
`;

export function buildUserPrompt(question: string): string {
  return `
用户问题: ${question}

请基于 v_aml_intelligence_hub 生成一个可直接执行的 PostgreSQL 查询。
如果用户提到“本周”，使用 date_trunc('week', now()) 作为时间边界。
如果用户提到“大额”，优先参考 amount_usd、rule_threshold_amount、threshold_breach_ratio。
如果用户提到“异常”或“风险”，优先结合 is_flagged、rule_severity、ai_money_laundering_prob、composite_risk_score。
只返回 JSON。
`;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSafeSelectStatement(sql: string): boolean {
  const normalized = stripSqlComments(sql).toLowerCase();
  return /^(select|with)\b/.test(normalized) && !SQL_BLOCKLIST.test(normalized);
}

function forceLimit50(sql: string): string {
  if (/\blimit\s+\d+\b/i.test(sql)) {
    return sql.replace(/\blimit\s+\d+\b/i, "LIMIT 50");
  }
  return `${sql}\nLIMIT 50`;
}

function addMathComments(sql: string): string {
  const comments: string[] = [];

  if (/\bai_money_laundering_prob\b/i.test(sql) && !/\\mathbb\{P\}/.test(sql)) {
    comments.push("-- $\\mathbb{P}(AML)$ 概率字段使用 ai_money_laundering_prob");
  }

  if (/\bavg\s*\(/i.test(sql) && !/\\mathbb\{E\}/.test(sql)) {
    comments.push("-- $\\mathbb{E}[X]$ 通过 AVG(...) 估计期望值");
  }

  return comments.length > 0 ? `${comments.join("\n")}\n${sql}` : sql;
}

export function enforceSqlGuardrails(rawSql: string): string {
  const cleaned = rawSql
    .replace(/```sql/gi, "")
    .replace(/```/g, "")
    .trim()
    .replace(/;+$/g, "");

  if (!cleaned) {
    throw new Error("Claude 没有返回可执行 SQL。");
  }

  if (!/\bv_aml_intelligence_hub\b/i.test(cleaned)) {
    throw new Error("SQL 必须查询 v_aml_intelligence_hub 视图。");
  }

  if (!isSafeSelectStatement(cleaned)) {
    throw new Error("仅允许安全的 SELECT 查询。");
  }

  return `${forceLimit50(addMathComments(cleaned))};`;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function parseClaudeSqlPayload(rawText: string): { sql: string; summary: string } {
  const direct = safeJsonParse<{ sql?: string; summary?: string }>(rawText.trim());
  if (direct?.sql) {
    return {
      sql: direct.sql,
      summary: direct.summary?.trim() || "已生成针对 AML 情报视图的查询。",
    };
  }

  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    const nested = safeJsonParse<{ sql?: string; summary?: string }>(fencedMatch[1].trim());
    if (nested?.sql) {
      return {
        sql: nested.sql,
        summary: nested.summary?.trim() || "已生成针对 AML 情报视图的查询。",
      };
    }
  }

  const objectMatch = rawText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const recovered = safeJsonParse<{ sql?: string; summary?: string }>(objectMatch[0]);
    if (recovered?.sql) {
      return {
        sql: recovered.sql,
        summary: recovered.summary?.trim() || "已生成针对 AML 情报视图的查询。",
      };
    }
  }

  throw new Error("无法从 Claude 响应中解析 SQL。");
}
