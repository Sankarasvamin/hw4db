import { NextRequest, NextResponse } from "next/server";

import {
  AML_SQL_SYSTEM_PROMPT,
  AskApiResponse,
  buildUserPrompt,
  enforceSqlGuardrails,
  parseClaudeSqlPayload,
  type JsonRow,
} from "@/lib/aml-query";
import { createServiceRoleClient } from "@/lib/supabase-admin";

export const runtime = "edge";

const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";
const SENSITIVE_SQL_REGEX = /\b(password|passwd|token|secret)\b/i;
const SYSTEM_SQL_REGEX = /\b(pg_[a-z0-9_]*|information_schema|current_setting|set_config)\b/i;
const DANGEROUS_SQL_REGEX =
  /\b(drop|delete|update|insert|truncate|alter|grant|revoke|create|comment)\b/i;
const ALLOWED_BASE_RELATIONS = new Set([
  "v_aml_intelligence_hub",
  "transactions",
  "accounts",
  "users",
  "risk_levels",
  "aml_alerts",
  "aml_rules",
  "transaction_types",
]);

interface AskRequestBody {
  question?: string;
}

interface ClaudeTextBlock {
  type: string;
  text?: string;
}

interface ClaudeMessageResponse {
  id: string;
  model: string;
  content: ClaudeTextBlock[];
  error?: {
    message?: string;
  };
}

function getClaudeApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 ANTHROPIC_API_KEY。");
  }

  return apiKey;
}

function extractClaudeText(payload: ClaudeMessageResponse): string {
  return payload.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCteNames(sql: string): Set<string> {
  const cteNames = new Set<string>();

  if (!/^\s*with\b/i.test(sql)) {
    return cteNames;
  }

  const cteRegex = /(?:^|,)\s*([a-z_][a-z0-9_]*)\s+(?:\([^)]+\)\s+)?as\s*\(/gi;
  for (const match of sql.matchAll(cteRegex)) {
    cteNames.add(match[1].toLowerCase());
  }

  return cteNames;
}

function extractReferencedRelations(sql: string): Set<string> {
  const relations = new Set<string>();
  const relationRegex =
    /\b(?:from|join)\s+((?:public\.)?[a-z_][a-z0-9_]*)\b/gi;

  for (const match of sql.matchAll(relationRegex)) {
    relations.add(match[1].replace(/^public\./i, "").toLowerCase());
  }

  return relations;
}

function validateGeneratedSql(sql: string) {
  const normalized = stripSqlComments(sql);

  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error("SQL 预检失败：仅允许 SELECT 或 WITH 查询。");
  }

  if (SENSITIVE_SQL_REGEX.test(normalized)) {
    throw new Error("SQL 预检失败：检测到敏感字段访问请求。");
  }

  if (SYSTEM_SQL_REGEX.test(normalized)) {
    throw new Error("SQL 预检失败：禁止访问系统表或系统配置函数。");
  }

  if (DANGEROUS_SQL_REGEX.test(normalized)) {
    throw new Error("SQL 预检失败：检测到危险 SQL 关键字。");
  }

  const cteNames = extractCteNames(normalized);
  const referencedRelations = extractReferencedRelations(normalized);

  if (referencedRelations.size === 0) {
    throw new Error("SQL 预检失败：未识别到合法业务表来源。");
  }

  for (const relation of referencedRelations) {
    if (cteNames.has(relation)) {
      continue;
    }

    if (!ALLOWED_BASE_RELATIONS.has(relation)) {
      throw new Error(`SQL 预检失败：禁止查询非业务表 ${relation}。`);
    }
  }

  if (
    !normalized.includes("v_aml_intelligence_hub") &&
    !normalized.includes("transactions")
  ) {
    throw new Error(
      "SQL 预检失败：查询必须以 v_aml_intelligence_hub 或 transactions 相关业务表为核心来源。",
    );
  }
}

async function generateSql(question: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": getClaudeApiKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 900,
      system: AML_SQL_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(question),
        },
      ],
    }),
  });

  const payload = (await response.json()) as ClaudeMessageResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || "Claude API 调用失败。");
  }

  const { sql, summary } = parseClaudeSqlPayload(extractClaudeText(payload));

  return {
    model: payload.model || CLAUDE_MODEL,
    sql: enforceSqlGuardrails(sql),
    summary,
  };
}

function normalizeRpcRows(data: unknown): JsonRow[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter((row): row is JsonRow => {
    return typeof row === "object" && row !== null && !Array.isArray(row);
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AskRequestBody;
    const question = body.question?.trim();

    if (!question) {
      return NextResponse.json(
        { error: "请提供查询问题。" },
        { status: 400 },
      );
    }

    const generated = await generateSql(question);
    validateGeneratedSql(generated.sql);
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("execute_aml_query", {
      sql_text: generated.sql,
    });

    if (error) {
      throw new Error(error.message);
    }

    const rows = normalizeRpcRows(data);
    const response: AskApiResponse = {
      question,
      sql: generated.sql,
      rows,
      rowCount: rows.length,
      summary: generated.summary,
      model: generated.model,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AML 查询执行失败。";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
