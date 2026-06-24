import { performance } from "perf_hooks";
import { recordHttpRequestMetric } from "../utils/runtimeMetrics.js";

export const requestMetrics = (req, res, next) => {
  const startedAt = performance.now();

  res.on("finish", () => {
    if (req.path?.startsWith("/debug")) {
      return;
    }

    recordHttpRequestMetric({
      durationMs: performance.now() - startedAt,
      statusCode: res.statusCode,
    });
  });

  next();
};
