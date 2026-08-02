import { useEffect, useState, useCallback } from 'react'
import { supabase, type Analysis } from './lib/supabase'
import { analyzeIncident, SAMPLE_INCIDENTS, type AnalysisResult } from './lib/analyzer'
import { Activity, AlertTriangle, ClipboardList, Database, Gauge, Layers, Loader2, Sparkles, Trash2, Zap } from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  memory_leak: 'Memory Leak',
  db_timeout: 'Database Timeout',
  cpu_spike: 'CPU Saturation',
  disk_full: 'Disk Exhaustion',
  network_error: 'Network Failure',
  null_pointer: 'Null Reference',
  deadlock: 'Deadlock',
  config_error: 'Configuration Error',
  dependency_failure: 'Dependency Failure',
  unknown: 'Unclassified',
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', label: 'Critical' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', label: 'Warning' },
  info: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30', label: 'Info' },
}

export default function App() {
  const [title, setTitle] = useState('')
  const [logs, setLogs] = useState('')
  const [metrics, setMetrics] = useState('')
  const [stackTrace, setStackTrace] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<Analysis[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) {
      setError('Could not load past analyses.')
    } else {
      setHistory((data as Analysis[]) || [])
    }
    setLoadingHistory(false)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleAnalyze = async () => {
    if (!logs.trim() && !metrics.trim() && !stackTrace.trim()) {
      setError('Provide at least logs, metrics, or a stack trace to analyze.')
      return
    }
    setError(null)
    setAnalyzing(true)
    setResult(null)

    await new Promise((r) => setTimeout(r, 900))

    const analysis = analyzeIncident({ logs, metrics, stackTrace })
    setResult(analysis)

    const { error: insertError } = await supabase.from('analyses').insert({
      title: title.trim() || 'Untitled Incident',
      logs,
      metrics,
      stack_trace: stackTrace,
      root_cause: analysis.rootCause,
      category: analysis.category as string,
      severity: analysis.severity as string,
      confidence: analysis.confidence,
      summary: analysis.summary,
      recommendations: analysis.recommendations,
      evidence: analysis.evidence,
    })

    if (insertError) {
      setError('Analysis completed, but it could not be saved to history.')
    } else {
      loadHistory()
    }
    setAnalyzing(false)
  }

  const loadSample = (idx: number) => {
    const sample = SAMPLE_INCIDENTS[idx]
    setTitle(sample.label)
    setLogs(sample.input.logs)
    setMetrics(sample.input.metrics)
    setStackTrace(sample.input.stackTrace)
    setResult(null)
    setError(null)
  }

  const handleClear = () => {
    setTitle('')
    setLogs('')
    setMetrics('')
    setStackTrace('')
    setResult(null)
    setError(null)
  }

  const handleDelete = async (id: string) => {
    await supabase.from('analyses').delete().eq('id', id)
    loadHistory()
  }

  const loadFromHistory = (a: Analysis) => {
    setTitle(a.title)
    setLogs(a.logs || '')
    setMetrics(a.metrics || '')
    setStackTrace(a.stack_trace || '')
    setResult({
      rootCause: a.root_cause || '',
      category: (a.category || 'unknown') as AnalysisResult['category'],
      severity: (a.severity || 'info') as AnalysisResult['severity'],
      confidence: a.confidence,
      summary: a.summary || '',
      recommendations: a.recommendations || [],
      evidence: a.evidence || [],
    })
  }

  const sev = result ? SEVERITY_STYLES[result.severity] : null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="lg:col-span-3 space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100">Incident Inputs</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleClear}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Incident title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Payment service crash at 14:02 UTC"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>

              <InputField
                icon={<ClipboardList className="h-4 w-4" />}
                label="Logs"
                value={logs}
                onChange={setLogs}
                placeholder="Paste raw log lines with timestamps and severity…"
              />
              <InputField
                icon={<Gauge className="h-4 w-4" />}
                label="Metrics"
                value={metrics}
                onChange={setMetrics}
                placeholder="cpu: 98%&#10;memory: 97%&#10;request_latency_p99_ms: 8800"
              />
              <InputField
                icon={<Layers className="h-4 w-4" />}
                label="Stack trace"
                value={stackTrace}
                onChange={setStackTrace}
                placeholder="java.lang.OutOfMemoryError: Java heap space&#10;    at com.paymentservice.handler.PaymentHandler.processPayment(…)"
              />

              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Run Root Cause Analysis
                  </>
                )}
              </button>

              {error && (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
              )}
            </div>

            {result && sev && (
              <ResultCard result={result} sev={sev} />
            )}
          </section>

          <aside className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Try a sample incident</h3>
              <div className="space-y-2">
                {SAMPLE_INCIDENTS.map((s, i) => (
                  <button
                    key={s.label}
                    onClick={() => loadSample(i)}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 text-left text-sm text-slate-300 transition hover:border-emerald-500/40 hover:bg-slate-800/60"
                  >
                    <Zap className="h-4 w-4 text-emerald-400" />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Analysis history</h3>
                <span className="text-xs text-slate-500">{history.length} saved</span>
              </div>
              {loadingHistory ? (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : history.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No analyses yet. Run one to see it here.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((a) => {
                    const s = SEVERITY_STYLES[a.severity || 'info']
                    return (
                      <li key={a.id} className="group rounded-lg border border-slate-800 bg-slate-950/50 p-3 transition hover:border-slate-600">
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => loadFromHistory(a)} className="min-w-0 flex-1 text-left">
                            <p className="truncate text-sm font-medium text-slate-200">{a.title}</p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{a.root_cause}</p>
                          </button>
                          <button
                            onClick={() => handleDelete(a.id)}
                            className="rounded p-1 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-red-400 group-hover:opacity-100"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text} ${s.border}`}>
                            {s.label}
                          </span>
                          <span className="text-[10px] text-slate-500">{CATEGORY_LABELS[a.category || 'unknown'] || a.category}</span>
                          <span className="text-[10px] text-slate-600">{new Date(a.created_at).toLocaleString()}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
          <Activity className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-slate-100">AI DevOps Engineer</h1>
          <p className="text-xs text-slate-500">Root cause analysis from logs, metrics & stack traces</p>
        </div>
      </div>
    </header>
  )
}

interface InputFieldProps {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}

function InputField({ icon, label, value, onChange, placeholder }: InputFieldProps) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={label === 'Stack trace' ? 5 : 4}
        className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40"
      />
    </div>
  )
}

interface ResultCardProps {
  result: AnalysisResult
  sev: { bg: string; text: string; border: string; label: string }
}

function ResultCard({ result, sev }: ResultCardProps) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl duration-500">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle className={`h-5 w-5 ${sev.text}`} />
        <h2 className="text-lg font-semibold text-slate-100">Diagnosis</h2>
      </div>

      <div className={`mb-5 rounded-xl border ${sev.border} ${sev.bg} p-4`}>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Root Cause</p>
        <p className="mt-1 text-lg font-semibold text-slate-50">{result.rootCause}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-xs font-medium text-slate-300">
            {CATEGORY_LABELS[result.category] || result.category}
          </span>
          <span className="text-xs text-slate-500">Confidence {result.confidence}%</span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-700 ${result.severity === 'critical' ? 'bg-red-500' : result.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500'}`}
            style={{ width: `${result.confidence}%` }}
          />
        </div>
      </div>

      <div className="mb-5">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
          <Database className="h-3.5 w-3.5" /> Summary
        </h3>
        <p className="text-sm leading-relaxed text-slate-300">{result.summary}</p>
      </div>

      {result.evidence.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Supporting evidence</h3>
          <ul className="space-y-1.5">
            {result.evidence.map((e, i) => (
              <li key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-400">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Recommended actions</h3>
        <ol className="space-y-2">
          {result.recommendations.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-300">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                {i + 1}
              </span>
              {r}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
