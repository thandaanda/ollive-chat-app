import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { emptyMetricsResponse } from "@/lib/empty-metrics";

export const runtime = "nodejs";

type CounterMap = Record<string, number>;

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      ...emptyMetricsResponse(),
      warning: "DATABASE_URL is not configured"
    });
  }

  let logs;
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    logs = await prisma.inferenceLog.findMany({
      where: {
        createdAt: { gte: since }
      },
      orderBy: { createdAt: "desc" },
      take: 1_000
    });
  } catch {
    return NextResponse.json({
      ...emptyMetricsResponse(),
      warning: "Database is not reachable"
    });
  }

  const completed = logs.filter((log) => log.status === "COMPLETED");
  const failed = logs.filter((log) => log.status === "FAILED");
  const cancelled = logs.filter((log) => log.status === "CANCELLED");
  const latencySamples = completed
    .map((log) => log.latencyMs)
    .filter((latency): latency is number => typeof latency === "number");

  return NextResponse.json({
    summary: {
      totalRequests: logs.length,
      completed: completed.length,
      failed: failed.length,
      cancelled: cancelled.length,
      errorRate: logs.length ? failed.length / logs.length : 0,
      averageLatencyMs: average(latencySamples),
      totalTokens: logs.reduce((sum, log) => sum + (log.totalTokens ?? 0), 0)
    },
    throughputByHour: mapToSeries(
      logs.reduce<CounterMap>((buckets, log) => {
        const hour = new Date(log.createdAt);
        hour.setMinutes(0, 0, 0);
        buckets[hour.toISOString()] = (buckets[hour.toISOString()] ?? 0) + 1;
        return buckets;
      }, {})
    ),
    providerBreakdown: mapToSeries(countBy(logs, (log) => log.provider)),
    modelBreakdown: mapToSeries(countBy(logs, (log) => log.model)),
    statusBreakdown: mapToSeries(countBy(logs, (log) => log.status.toLowerCase()))
  });
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countBy<T>(items: T[], keyForItem: (item: T) => string): CounterMap {
  return items.reduce<CounterMap>((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function mapToSeries(map: CounterMap) {
  return Object.entries(map)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => ({ label, value }));
}
