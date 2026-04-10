import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download } from "lucide-react";

import type { JsonRow, JsonValue } from "@/lib/aml-query";

interface DataTableProps {
  generatedSql: string;
  data: JsonRow[];
}

const PAGE_SIZE = 10;
const STAT_COLUMN_REGEX = /(^avg_|_avg$|mean|expected|expectation|stddev|variance|median|percentile|ratio)/i;

function hasStatisticalPrecisionRequirement(generatedSql: string, columns: string[]) {
  return (
    /\\mathbb\{E\}|\bavg\s*\(/i.test(generatedSql) ||
    columns.some((column) => STAT_COLUMN_REGEX.test(column))
  );
}

function formatNumber(value: number, highPrecision: boolean) {
  if (Number.isInteger(value) && !highPrecision) {
    return value.toString();
  }

  const digits = highPrecision ? 6 : 4;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function buildCsv(columns: string[], rows: JsonRow[]) {
  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const lines = [
    columns.map(escapeCsv).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const cell = row[column];
          if (cell === null || typeof cell === "undefined") {
            return escapeCsv("");
          }
          if (typeof cell === "object") {
            return escapeCsv(JSON.stringify(cell));
          }
          return escapeCsv(String(cell));
        })
        .join(","),
    ),
  ];

  return lines.join("\n");
}

function getRiskTone(value: JsonValue | undefined) {
  if (typeof value !== "number") {
    return "";
  }

  if (value > 80) {
    return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200";
  }

  if (value >= 60) {
    return "bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-200";
  }

  return "bg-slate-100 text-slate-700";
}

function renderValue(
  column: string,
  value: JsonValue | undefined,
  useHighPrecision: boolean,
) {
  if (value === null || typeof value === "undefined") {
    return <span className="text-slate-400">null</span>;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (column === "composite_risk_score") {
      const label = value > 80 ? "Critical" : value >= 60 ? "High" : "Normal";
      return (
        <span
          className={`inline-flex min-w-[92px] justify-center rounded-full px-3 py-1 text-xs font-semibold ${getRiskTone(value)}`}
        >
          {formatNumber(value, false)} · {label}
        </span>
      );
    }

    const precisionRequired =
      useHighPrecision || STAT_COLUMN_REGEX.test(column);
    return formatNumber(value, precisionRequired);
  }

  if (typeof value === "string") {
    return value;
  }

  return (
    <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
      {JSON.stringify(value)}
    </code>
  );
}

export function DataTable({ generatedSql, data }: DataTableProps) {
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const columns = useMemo(
    () =>
      Array.from(
        data.reduce((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set<string>()),
      ),
    [data],
  );

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return data.slice(start, start + PAGE_SIZE);
  }, [currentPage, data]);
  const useHighPrecision = hasStatisticalPrecisionRequirement(
    generatedSql,
    columns,
  );

  useEffect(() => {
    setPage(1);
  }, [data, generatedSql]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopySql() {
    await navigator.clipboard.writeText(generatedSql);
    setCopied(true);
  }

  function handleExportCsv() {
    const csv = buildCsv(columns, data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "aml-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (data.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
        <div className="flex items-center justify-end gap-3 pb-6">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleCopySql()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy SQL
          </button>
        </div>
        当前查询没有返回结果。
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-slate-950">
            Found {data.length} results
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {useHighPrecision
              ? "统计结果已按 $\\mathbb{E}[X]$ 场景提高数值精度。"
              : "当前展示为查询结果原始字段的动态表格。"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleCopySql()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy SQL
          </button>
        </div>
      </div>

      <div className="max-h-[560px] overflow-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-950 text-slate-100">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap border-b border-slate-800 px-4 py-3 font-medium"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIndex) => (
              <tr
                key={`${String(row.transaction_id ?? row.reference_code ?? `${currentPage}-${rowIndex}`)}`}
                className="border-b border-slate-100 align-top odd:bg-white even:bg-slate-50/70"
              >
                {columns.map((column) => (
                  <td key={column} className="px-4 py-3 text-slate-700">
                    <div className="min-w-[140px] whitespace-pre-wrap break-words">
                      {renderValue(column, row[column], useHighPrecision)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
        <p className="text-sm text-slate-500">
          Page {currentPage} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage === 1}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </button>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            disabled={currentPage === totalPages}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
