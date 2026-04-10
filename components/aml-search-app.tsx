"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  DatabaseZap,
  LoaderCircle,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { DataTable } from "@/components/data-table";
import type { AskApiResponse } from "@/lib/aml-query";

const loadingMessages = [
  "Claude 正在分析链上风险...",
  "正在将自然语言映射为 AML SQL...",
  "正在调用 Supabase RPC 拉取情报结果...",
];

const samplePrompts = [
  "查询本周大额异常转账",
  "找出涉及制裁名单且风险评分最高的交易",
  "统计本周每天可疑交易的平均金额",
];

export function AmlSearchApp() {
  const [question, setQuestion] = useState(samplePrompts[0]);
  const [result, setResult] = useState<AskApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLoadingIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setLoadingIndex((current) => (current + 1) % loadingMessages.length);
    }, 1600);

    return () => window.clearInterval(timer);
  }, [loading]);

  async function runQuery(nextQuestion?: string) {
    const actualQuestion = (nextQuestion ?? question).trim();

    if (!actualQuestion) {
      setError("请输入 AML 查询问题。");
      return;
    }

    setQuestion(actualQuestion);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ question: actualQuestion }),
      });

      const payload = (await response.json()) as AskApiResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "请求失败。");
      }

      setResult(payload);
    } catch (requestError) {
      setResult(null);
      setError(
        requestError instanceof Error ? requestError.message : "请求失败。",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery();
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-mist px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[8%] top-20 h-48 w-48 rounded-full bg-emerald-200/60 blur-3xl" />
        <div className="absolute right-[10%] top-12 h-72 w-72 animate-drift rounded-full bg-orange-200/50 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-cyan-200/50 blur-3xl" />
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-soft backdrop-blur xl:p-8">
          <div className="mb-8 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1.5 text-slate-100">
              <ShieldAlert className="h-4 w-4" />
              AML Intelligence
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5">
              <DatabaseZap className="h-4 w-4 text-accent" />
              v_aml_intelligence_hub
            </span>
          </div>

          <div className="max-w-3xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Edge Runtime + Supabase RPC + Claude 3.5 Sonnet
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              让自然语言直接驱动反洗钱情报检索。
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              输入问题，系统会把描述转换为面向{" "}
              <code className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-800">
                v_aml_intelligence_hub
              </code>{" "}
              的安全 SQL，再通过 Supabase RPC 返回结果。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8">
            <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-slate-950 p-4 sm:p-5">
              <label className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">
                AML Query
              </label>
              <div className="flex flex-col gap-3 lg:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="例如：查询本周大额异常转账"
                    className="h-14 w-full rounded-2xl border border-slate-800 bg-slate-900 pl-12 pr-4 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 text-sm font-medium text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      分析中
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      开始检索
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-3">
            {samplePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void runQuery(prompt)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-accent hover:text-slate-950"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <section className="rounded-[32px] border border-white/70 bg-white/80 p-8 shadow-soft backdrop-blur">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <LoaderCircle className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <p className="text-lg font-medium text-slate-950">
                  {loadingMessages[loadingIndex]}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  正在生成 SQL、做安全校验并拉取最多 50 条结果。
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        {result ? (
          <>
            <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
              <article className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Generated SQL
                </p>
                <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm leading-7 text-emerald-300">
                  <code>{result.sql}</code>
                </pre>
              </article>

              <article className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Query Insight
                </p>
                <div className="mt-4 space-y-4 text-sm text-slate-600">
                  <div>
                    <p className="text-slate-950">问题</p>
                    <p className="mt-1 leading-6">{result.question}</p>
                  </div>
                  <div>
                    <p className="text-slate-950">解释</p>
                    <p className="mt-1 leading-6">{result.summary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Rows
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">
                        {result.rowCount}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Model
                      </p>
                      <p className="mt-2 text-sm font-medium text-slate-950">
                        {result.model}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            </section>

            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Intelligence Result
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                    动态结果表
                  </h2>
                </div>
              </div>
              <DataTable generatedSql={result.sql} data={result.rows} />
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
