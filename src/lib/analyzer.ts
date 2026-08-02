export type Severity = 'critical' | 'warning' | 'info'
export type Category =
  | 'memory_leak'
  | 'db_timeout'
  | 'cpu_spike'
  | 'disk_full'
  | 'network_error'
  | 'null_pointer'
  | 'deadlock'
  | 'config_error'
  | 'dependency_failure'
  | 'unknown'

export interface AnalysisResult {
  rootCause: string
  category: Category
  severity: Severity
  confidence: number
  summary: string
  recommendations: string[]
  evidence: string[]
}

interface AnalysisInput {
  logs: string
  metrics: string
  stackTrace: string
}

interface Pattern {
  category: Category
  severity: Severity
  keywords: string[]
  rootCauseTemplate: (ctx: MatchContext) => string
  summary: (ctx: MatchContext) => string
  recommendations: string[]
  weight: number
}

interface MatchContext {
  service: string
  matchedLine: string
  heapSize?: string
  dbQuery?: string
  endpoint?: string
  cpuValue?: string
  memoryValue?: string
  diskPercent?: string
}

const PATTERNS: Pattern[] = [
  {
    category: 'memory_leak',
    severity: 'critical',
    keywords: ['OutOfMemoryError', 'heap', 'GC overhead', 'memory leak', 'OOM', 'java.lang.OutOfMemory', 'Cannot allocate memory', 'MemoryError'],
    weight: 10,
    rootCauseTemplate: (ctx) => `Memory leak in ${ctx.service}.`,
    summary: (ctx) =>
      `Heap usage climbs monotonically while garbage collection fails to reclaim memory, culminating in an OutOfMemoryError. The ${ctx.service} process exhausted its heap${ctx.heapSize ? ` (limit ${ctx.heapSize})` : ''} and was terminated by the runtime. This is consistent with an unreferenced object accumulation pattern rather than a transient load spike.`,
    recommendations: [
      'Take a heap dump at the point of failure and inspect retained object graphs for unexpected references.',
      'Review recent deployments for new caches, listeners, or static collections that never evict.',
      'Increase heap size as a temporary mitigation and add memory pressure alerts at 80% usage.',
      'Add a memory leak regression test that runs the suspected path under load and asserts stable heap growth.',
    ],
  },
  {
    category: 'db_timeout',
    severity: 'critical',
    keywords: ['timeout', 'timed out', 'connection refused', 'deadlock', 'lock wait timeout', 'statement timeout', 'pool exhausted', 'Connection pool'],
    weight: 9,
    rootCauseTemplate: (ctx) => `Database timeout in ${ctx.service}${ctx.dbQuery ? ` on query: ${ctx.dbQuery}` : ''}.`,
    summary: (ctx) =>
      `A database operation in ${ctx.service} exceeded its timeout threshold${ctx.dbQuery ? ` while executing ${ctx.dbQuery}` : ''}. Connection pool telemetry shows saturation, and the error propagated up the call stack as a 500 to the caller. The root cause is a slow or blocked query, not a network partition.`,
    recommendations: [
      'Run EXPLAIN ANALYZE on the offending query and add missing indexes for the filter columns.',
      'Check for long-running transactions holding locks that block the timed-out query.',
      'Review connection pool sizing and ensure queries are bounded by an explicit statement timeout.',
      'Add a query-duration metric and alert when p99 latency exceeds the SLA.',
    ],
  },
  {
    category: 'cpu_spike',
    severity: 'warning',
    keywords: ['cpu', 'CPU', 'load average', 'high load', 'throttling', '100% cpu', 'cpu throttled'],
    weight: 7,
    rootCauseTemplate: (ctx) => `CPU saturation in ${ctx.service}${ctx.cpuValue ? ` (${ctx.cpuValue})` : ''}.`,
    summary: (ctx) =>
      `Sustained CPU utilization in ${ctx.service}${ctx.cpuValue ? ` reaching ${ctx.cpuValue}` : ''} with load average exceeding available cores. Response latency degrades as the scheduler queues work. The spike correlates with a deploy window, suggesting a hot code path rather than organic traffic growth.`,
    recommendations: [
      'Profile the hot function with a CPU flame graph and look for an accidental O(n^2) loop.',
      'Check whether a recent deploy introduced a synchronous busy-wait or re-computation.',
      'Scale horizontally as a stopgap and add an autoscaling policy keyed on CPU.',
      'Add a CPU-usage alert at 85% sustained for 5 minutes.',
    ],
  },
  {
    category: 'disk_full',
    severity: 'critical',
    keywords: ['No space left on device', 'disk full', 'ENOSPC', 'inode', 'write failed', 'cannot write'],
    weight: 8,
    rootCauseTemplate: (ctx) => `Disk exhaustion in ${ctx.service}${ctx.diskPercent ? ` (${ctx.diskPercent} full)` : ''}.`,
    summary: (ctx) =>
      `The filesystem backing ${ctx.service} ran out of writable space${ctx.diskPercent ? ` (reached ${ctx.diskPercent})` : ''}. Writes began failing with ENOSPC, which surfaced as 500s to clients. Log rotation and ephemeral file cleanup are not keeping pace with write volume.`,
    recommendations: [
      'Identify the largest space consumers with du and remove stale logs and temp files.',
      'Enable log rotation with size-based triggers and a retention cap.',
      'Move ephemeral storage to a dedicated volume with autoscaling.',
      'Add a disk-usage alert at 85% so exhaustion is caught before writes fail.',
    ],
  },
  {
    category: 'network_error',
    severity: 'warning',
    keywords: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'socket hang up', '502 Bad Gateway', '503 Service Unavailable', 'upstream', 'connection reset'],
    weight: 6,
    rootCauseTemplate: (ctx) => `Upstream connectivity failure in ${ctx.service}${ctx.endpoint ? ` to ${ctx.endpoint}` : ''}.`,
    summary: (ctx) =>
      `${ctx.service} could not reach a dependency${ctx.endpoint ? ` at ${ctx.endpoint}` : ''}. The error is a connection reset or refusal, indicating the downstream service was unavailable or rejecting connections at the time of the request.`,
    recommendations: [
      'Verify the downstream service health and recent restarts in its own logs.',
      'Add a circuit breaker so failures degrade gracefully instead of cascading.',
      'Confirm DNS resolution and that the target endpoint has not changed.',
      'Add retries with exponential backoff for idempotent calls only.',
    ],
  },
  {
    category: 'null_pointer',
    severity: 'critical',
    keywords: ['NullPointerException', 'TypeError: Cannot read', 'undefined is not', 'NoneType', 'AttributeError', 'cannot read properties of null'],
    weight: 8,
    rootCauseTemplate: (ctx) => `Unhandled null reference in ${ctx.service}.`,
    summary: (ctx) =>
      `A null or undefined value reached code in ${ctx.service} that assumed a present object. The exception propagated uncaught and crashed the request. The immediate cause is a missing null guard; the underlying cause is an upstream contract that can return empty for an input the caller did not expect.`,
    recommendations: [
      'Add a null check at the failure site and return a clear error instead of crashing.',
      'Trace the value back to its source and tighten the contract so empty is explicit.',
      'Add a unit test covering the null-input branch that triggered this crash.',
      'Consider a null-safe type or optional to make absence explicit in the type system.',
    ],
  },
  {
    category: 'deadlock',
    severity: 'critical',
    keywords: ['deadlock', 'Deadlock', 'circular wait', 'lock contention', 'Lock held', 'waiting on lock'],
    weight: 8,
    rootCauseTemplate: (ctx) => `Deadlock in ${ctx.service}.`,
    summary: (ctx) =>
      `Two or more operations in ${ctx.service} acquired locks and then each waited on a resource the other held, forming a circular wait. The database or runtime detected the deadlock and killed one participant, surfacing as an error to the client.`,
    recommendations: [
      'Ensure all code paths acquire locks in a consistent global order.',
      'Keep lock-holding sections short and free of external calls.',
      'Add a lock-timeout so waits fail fast instead of hanging.',
      'Log the resource IDs involved to reproduce the ordering violation.',
    ],
  },
  {
    category: 'config_error',
    severity: 'warning',
    keywords: ['config', 'environment variable', 'ENV', 'missing key', 'invalid configuration', 'secret not found', 'Unauthorized', '403', '401'],
    weight: 6,
    rootCauseTemplate: (ctx) => `Configuration error in ${ctx.service}.`,
    summary: (ctx) =>
      `${ctx.service} failed because a required configuration value was missing or invalid. The error is an access denial or a missing-key message, not a runtime fault. The most likely cause is an environment variable or secret that was not provisioned for this deployment.`,
    recommendations: [
      'Compare the environment of the failing instance against a known-good one.',
      'Validate required configuration at startup and fail fast with a clear message.',
      'Confirm secrets were rotated and the new value propagated to all replicas.',
      'Add a config-drift check to the deploy pipeline.',
    ],
  },
  {
    category: 'dependency_failure',
    severity: 'warning',
    keywords: ['dependency', 'module not found', 'Cannot find module', 'ImportError', 'ModuleNotFoundError', 'version mismatch', 'peer dependency'],
    weight: 6,
    rootCauseTemplate: (ctx) => `Dependency resolution failure in ${ctx.service}.`,
    summary: (ctx) =>
      `${ctx.service} failed to load a required dependency. The error indicates a missing or incompatible module, typically introduced by a partial deploy or an unpinned version that drifted.`,
    recommendations: [
      'Lock all dependency versions and verify the lockfile is committed.',
      'Re-run the build in a clean environment to confirm reproducibility.',
      'Check the failing module against the lockfile for a missing peer dependency.',
      'Add a post-deploy smoke test that imports critical modules.',
    ],
  },
]

function extractService(input: AnalysisInput): string {
  const sources = [input.logs, input.stackTrace, input.metrics]
  for (const src of sources) {
    if (!src) continue
    const serviceMatch = src.match(/(?:service|app|component|module|svc)[=:]\s*"?([A-Za-z0-9_-]+)"?/i)
    if (serviceMatch) return serviceMatch[1]
    const pathMatch = src.match(/at\s+([A-Za-z0-9_.]+)\./)
    if (pathMatch) {
      const parts = pathMatch[1].split('.')
      const candidate = parts.find((p) => /service|controller|handler|worker/i.test(p)) || parts[parts.length - 1]
      if (candidate) return candidate.replace(/(Service|Controller|Handler|Worker)$/, (m) => m.toLowerCase())
    }
  }
  return 'the affected service'
}

function extractContext(input: AnalysisInput, matchedLine: string): MatchContext {
  const ctx: MatchContext = { service: extractService(input), matchedLine }
  const heapMatch = input.metrics.match(/(\d+\s?(?:GB|MB|gb|mb))\s*heap/i) || input.logs.match(/heap size\s*[:=]?\s*(\d+\s?(?:GB|MB|gb|mb))/i)
  if (heapMatch) ctx.heapSize = heapMatch[1]
  const dbMatch = input.logs.match(/(?:query|sql|statement)\s*[:=]?\s*"?([^"\n]{5,80})"?/i)
  if (dbMatch) ctx.dbQuery = dbMatch[1].trim()
  const epMatch = input.logs.match(/(?:endpoint|url|host)\s*[:=]?\s*(https?:\/\/[^\s]+|[A-Za-z0-9.-]+:\d+)/i)
  if (epMatch) ctx.endpoint = epMatch[1]
  const cpuMatch = input.metrics.match(/cpu[s]?\s*[:=]?\s*(\d+(?:\.\d+)?%?)/i)
  if (cpuMatch) ctx.cpuValue = cpuMatch[1] + (cpuMatch[1].endsWith('%') ? '' : '%')
  const memMatch = input.metrics.match(/mem(?:ory)?\s*[:=]?\s*(\d+(?:\.\d+)?%?)/i)
  if (memMatch) ctx.memoryValue = memMatch[1] + (memMatch[1].endsWith('%') ? '' : '%')
  const diskMatch = input.metrics.match(/disk\s*[:=]?\s*(\d+(?:\.\d+)?%?)/i)
  if (diskMatch) ctx.diskPercent = diskMatch[1] + (diskMatch[1].endsWith('%') ? '' : '%')
  return ctx
}

function scorePattern(pattern: Pattern, input: AnalysisInput): { score: number; matchedLine: string } {
  const corpus = `${input.logs}\n${input.metrics}\n${input.stackTrace}`.toLowerCase()
  let score = 0
  let matchedLine = ''
  for (const kw of pattern.keywords) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (re.test(corpus)) {
      score += pattern.weight
      if (!matchedLine) {
        const lines = corpus.split('\n')
        const line = lines.find((l) => re.test(l))
        if (line) matchedLine = line.trim()
      }
    }
  }
  return { score, matchedLine }
}

export function analyzeIncident(raw: AnalysisInput): AnalysisResult {
  const input: AnalysisInput = {
    logs: raw.logs || '',
    metrics: raw.metrics || '',
    stackTrace: raw.stackTrace || '',
  }

  const scored = PATTERNS.map((p) => ({ pattern: p, ...scorePattern(p, input) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return {
      rootCause: 'Unable to determine a single root cause from the provided inputs.',
      category: 'unknown',
      severity: 'info',
      confidence: 20,
      summary:
        'The provided logs, metrics, and stack trace did not contain enough recognizable signals to classify the incident automatically. Provide more complete inputs, especially the full stack trace and the metrics around the failure time, for a higher-confidence diagnosis.',
      recommendations: [
        'Attach the full stack trace including the topmost application frame.',
        'Include metrics from the 15 minutes surrounding the failure (CPU, memory, latency).',
        'Add the raw log lines with timestamps, not just a summary.',
      ],
      evidence: [],
    }
  }

  const best = scored[0]
  const ctx = extractContext(input, best.matchedLine)
  const pattern = best.pattern

  const evidence: string[] = []
  if (best.matchedLine) evidence.push(best.matchedLine)
  const traceLines = input.stackTrace.split('\n').filter((l) => l.trim()).slice(0, 3)
  for (const l of traceLines) {
    if (!evidence.includes(l.trim())) evidence.push(l.trim())
  }
  const metricLines = input.metrics.split('\n').filter((l) => l.trim()).slice(0, 2)
  for (const l of metricLines) {
    if (!evidence.includes(l.trim())) evidence.push(l.trim())
  }

  const totalPossible = pattern.keywords.length * pattern.weight
  const confidence = Math.min(98, Math.round((best.score / totalPossible) * 100) + 40)

  return {
    rootCause: pattern.rootCauseTemplate(ctx),
    category: pattern.category,
    severity: pattern.severity,
    confidence,
    summary: pattern.summary(ctx),
    recommendations: pattern.recommendations,
    evidence: evidence.slice(0, 6),
  }
}

export const SAMPLE_INCIDENTS: { label: string; input: AnalysisInput }[] = [
  {
    label: 'Memory leak in payment service',
    input: {
      logs: `2026-07-30T14:02:11.002Z service=payment-service level=ERROR msg="OutOfMemoryError: Java heap space" thread=http-nio-8080-exec-12
2026-07-30T14:02:10.001 service=payment-service level=WARN msg="GC overhead limit exceeded" attempts=14
2026-07-30T14:01:58.778 service=payment-service level=INFO msg="processing payment" request_id=ab12cd`,
      metrics: `heap: 7.8GB / 8GB
gc_pause_ms: 4200
memory: 97%
cpu: 62%
request_latency_p99_ms: 8800`,
      stackTrace: `java.lang.OutOfMemoryError: Java heap space
    at com.paymentservice.handler.PaymentHandler.processPayment(PaymentHandler.java:88)
    at com.paymentservice.handler.PaymentHandler.handleRequest(PaymentHandler.java:54)
    at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1067)`,
    },
  },
  {
    label: 'Database timeout in order service',
    input: {
      logs: `2026-07-30T09:14:02.111 service=order-service level=ERROR msg="statement timeout" query="UPDATE orders SET status='paid' WHERE id=$1"
2026-07-30T09:14:01.900 service=order-service level=WARN msg="connection pool exhausted" active=50 idle=0
2026-07-30T09:13:55.000 service=order-service level=INFO msg="begin checkout" request_id=xy99z`,
      metrics: `db_connections_active: 50
db_connections_idle: 0
db_query_p99_ms: 31000
cpu: 34%
memory: 55%`,
      stackTrace: `org.postgresql.util.PSQLException: ERROR: canceling statement due to statement timeout
    at com.orderservice.repo.OrderRepository.updateStatus(OrderRepository.java:112)
    at com.orderservice.service.CheckoutService.finalize(CheckoutService.java:77)
    at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)`,
    },
  },
  {
    label: 'CPU spike in search service',
    input: {
      logs: `2026-07-30T11:00:12.000 service=search-service level=WARN msg="high load" load_average=16.0
2026-07-30T11:00:10.000 service=search-service level=INFO msg="reindex triggered" corpus=12M docs
2026-07-30T10:59:50.000 service=search-service level=WARN msg="cpu throttled" cpu=98%`,
      metrics: `cpu: 98%
load_average: 16.0
request_latency_p99_ms: 4200
memory: 60%
disk: 40%`,
      stackTrace: `java.lang.OutOfMemoryError: Java heap space
    at com.searchservice.index.ReindexWorker.buildIndex(ReindexWorker.java:201)
    at com.searchservice.index.ReindexWorker.run(ReindexWorker.java:120)`,
    },
  },
]
