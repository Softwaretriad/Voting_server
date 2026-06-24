const MAX_SAMPLES = Number(process.env.RUNTIME_METRICS_MAX_SAMPLES || 1000);

const httpDurations = [];
const voteDurations = [];
const counters = {
  httpRequests: 0,
  httpErrors: 0,
  voteCasts: 0,
};

const pushSample = (samples, value) => {
  samples.push(Number(value || 0));
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
};

const percentile = (samples, percentileValue) => {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1
  );
  return Math.round(sorted[index] * 100) / 100;
};

export const recordHttpRequestMetric = ({ durationMs, statusCode }) => {
  counters.httpRequests += 1;
  if (Number(statusCode) >= 500) {
    counters.httpErrors += 1;
  }
  pushSample(httpDurations, durationMs);
};

export const recordVoteCastMetric = ({ durationMs }) => {
  counters.voteCasts += 1;
  pushSample(voteDurations, durationMs);
};

export const getRuntimeMetrics = () => ({
  http: {
    requests: counters.httpRequests,
    errors: counters.httpErrors,
    errorRate:
      counters.httpRequests > 0
        ? Math.round((counters.httpErrors / counters.httpRequests) * 10000) / 100
        : 0,
    sampleSize: httpDurations.length,
    p95Ms: percentile(httpDurations, 95),
    p99Ms: percentile(httpDurations, 99),
  },
  votes: {
    casts: counters.voteCasts,
    sampleSize: voteDurations.length,
    p95Ms: percentile(voteDurations, 95),
    p99Ms: percentile(voteDurations, 99),
  },
});
