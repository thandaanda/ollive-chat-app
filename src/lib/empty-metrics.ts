export function emptyMetricsResponse() {
  return {
    summary: {
      totalRequests: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      errorRate: 0,
      averageLatencyMs: 0,
      totalTokens: 0
    },
    throughputByHour: [],
    providerBreakdown: [],
    modelBreakdown: [],
    statusBreakdown: []
  };
}
