import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ApiContract } from '../shared/api'
import { SCENARIO_IDS, type ProviderMode } from '../shared/domain'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { Icon, type IconName } from './components/Icon'
import {
  SCENARIO_META,
  type EvidenceRef,
  type LineComparisonView,
  type ScenarioId,
  type SourceFile,
  type TraceEventView,
  type WorkspaceStatus,
  type WorkspaceView,
  useSupplierOps,
} from './hooks/useSupplierOps'

export interface SupplierOpsAppProps {
  api?: ApiContract
  initialScenarioId?: ScenarioId
}

const workflowSteps: Array<{
  id: 'ingest' | 'parse' | 'reconcile' | 'draft' | 'approve'
  label: string
  note: string
}> = [
  { id: 'ingest', label: 'Ingest', note: 'Packet received' },
  { id: 'parse', label: 'Parse', note: 'Fields extracted' },
  { id: 'reconcile', label: 'Reconcile', note: 'Compare evidence' },
  { id: 'draft', label: 'Draft', note: 'Prepare correction' },
  { id: 'approve', label: 'Approve', note: 'Human decision' },
]

const statusLabels: Record<WorkspaceStatus, string> = {
  loading: 'Loading',
  ready: 'Review ready',
  warning: 'Needs review',
  blocked: 'Blocked',
  error: 'Error',
  offline: 'Offline path',
  'rate-limited': 'Rate limited',
  'invalid-output': 'Invalid output',
  approved: 'Approved',
  executed: 'Executed',
  empty: 'Import required',
}

const statusIcon: Record<WorkspaceStatus, IconName> = {
  loading: 'refresh',
  ready: 'check',
  warning: 'warning',
  blocked: 'lock',
  error: 'alert',
  offline: 'database',
  'rate-limited': 'warning',
  'invalid-output': 'alert',
  approved: 'user-check',
  executed: 'check',
  empty: 'upload',
}

const classNames = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ')

function StatusBadge({ status, compact = false }: { status: WorkspaceStatus; compact?: boolean }) {
  return (
    <span
      className={classNames(
        'status-badge',
        `status-badge--${status}`,
        compact && 'status-badge--compact',
      )}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  )
}

function EvidenceButton({
  evidence,
  onOpen,
}: {
  evidence: EvidenceRef
  onOpen: (evidence: EvidenceRef) => void
}) {
  return (
    <button
      type="button"
      className="citation"
      onClick={() => onOpen(evidence)}
      aria-label={`Open evidence ${evidence.fileName}, page ${evidence.page}`}
    >
      <Icon name="file" size={13} />
      <span>{evidence.label || `p. ${evidence.page}`}</span>
    </button>
  )
}

function DialogShell({
  title,
  titleId,
  children,
  onClose,
  drawer = false,
  wide = false,
}: {
  title: string
  titleId?: string
  children: ReactNode
  onClose: () => void
  drawer?: boolean
  wide?: boolean
}) {
  const generatedTitleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className={classNames('dialog-backdrop', drawer && 'dialog-backdrop--drawer')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={classNames('dialog', drawer && 'dialog--drawer', wide && 'dialog--wide')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId ?? generatedTitleId}
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">SupplierOps Lab</p>
            <h2 id={titleId ?? generatedTitleId}>{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </section>
    </div>
  )
}

function WorkflowRail({ workspace }: { workspace: WorkspaceView }) {
  const currentIndex = workflowSteps.findIndex((step) => step.id === workspace.phase)
  const blocked =
    workspace.status === 'blocked' ||
    workspace.status === 'error' ||
    workspace.status === 'invalid-output'
  return (
    <nav className="workflow-rail" aria-label="Workflow progress">
      <div className="workflow-rail__label">Workflow</div>
      <ol className="workflow-steps">
        {workflowSteps.map((step, index) => {
          const complete =
            index < currentIndex ||
            workspace.status === 'approved' ||
            workspace.status === 'executed'
          const active = index === currentIndex
          return (
            <li
              className={classNames(
                'workflow-step',
                active && 'workflow-step--active',
                complete && 'workflow-step--complete',
                blocked && active && 'workflow-step--blocked',
              )}
              key={step.id}
            >
              <span className="workflow-step__marker" aria-hidden="true">
                {complete ? <Icon name="check" size={13} /> : index + 1}
              </span>
              <span className="workflow-step__copy">
                <strong>{step.label}</strong>
                <small>{active ? statusLabels[workspace.status] : step.note}</small>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function TopBar({
  workspace,
  scenarioId,
  apiAvailable,
  providerMode,
  onProviderMode,
  onRun,
  isRunning,
  onScenario,
  onReplay,
  onSave,
  regressionSaved,
  theme,
  onToggleTheme,
}: {
  workspace: WorkspaceView
  scenarioId: ScenarioId
  apiAvailable: boolean
  providerMode: ProviderMode
  onProviderMode: (mode: ProviderMode) => void
  onRun: () => void
  isRunning: boolean
  onScenario: (scenarioId: ScenarioId) => void
  onReplay: () => void
  onSave: () => void
  regressionSaved: boolean
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          SO
        </span>
        <span className="brand-copy">
          <strong>SupplierOps Lab</strong>
          <small>Exception resolution console</small>
        </span>
      </div>

      <div className="topbar__case" aria-label="Current case">
        <span className="topbar__case-label">Current case</span>
        <strong>{workspace.caseNumber}</strong>
        <span className="topbar__case-divider" aria-hidden="true">
          /
        </span>
        <span>{workspace.supplier}</span>
      </div>

      <div className="topbar__controls">
        <span className="sandbox-indicator" title="All side effects stay in the local sandbox">
          <span className="sandbox-indicator__dot" aria-hidden="true" />
          Local sandbox
        </span>
        <span className="provider-indicator" title="No live supplier system is connected">
          <Icon name="shield" size={14} />
          {apiAvailable ? 'Desktop bridge available' : 'Desktop bridge unavailable'}
        </span>
        <label className="scenario-control">
          <span className="sr-only">Choose scenario</span>
          <select
            value={scenarioId}
            onChange={(event) => onScenario(event.target.value as ScenarioId)}
            aria-label="Choose scenario"
          >
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {SCENARIO_META[id].label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
        <label
          className={classNames(
            'provider-control',
            scenarioId === 'prompt-injection' && 'provider-control--locked',
          )}
          title={
            scenarioId === 'prompt-injection'
              ? 'Prompt-injection cases cannot call a provider.'
              : scenarioId === 'clean-match' || scenarioId === 'price-mismatch'
                ? 'This scenario uses deterministic controls; AI is not needed, even if provider mode is selected.'
                : 'Provider mode may send bounded document excerpts to DeepSeek.'
          }
        >
          <span className="sr-only">Provider mode</span>
          <select
            value={providerMode}
            onChange={(event) => onProviderMode(event.target.value as ProviderMode)}
            disabled={isRunning || scenarioId === 'prompt-injection'}
            aria-label="Provider mode"
          >
            <option value="offline">Offline</option>
            <option value="provider">DeepSeek provider</option>
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
        <button
          type="button"
          className="button button--small button--secondary topbar__run"
          onClick={onRun}
          disabled={isRunning}
          aria-label="Run current scenario"
        >
          <Icon name={isRunning ? 'refresh' : 'play'} size={14} />
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          className="icon-button topbar__action"
          onClick={onReplay}
          aria-label="Replay current scenario"
          title="Replay current scenario"
        >
          <Icon name="refresh" size={16} />
        </button>
        <button
          type="button"
          className={classNames('topbar__save', regressionSaved && 'topbar__save--saved')}
          onClick={onSave}
        >
          <Icon name={regressionSaved ? 'check' : 'clipboard'} size={14} />
          {regressionSaved ? 'Regression saved' : 'Save regression'}
        </button>
        <button
          type="button"
          className="icon-button topbar__action"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          title="Toggle theme"
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} />
        </button>
      </div>
    </header>
  )
}

function LoadingStrip({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null
  return (
    <div className="loading-strip" role="status" aria-live="polite">
      <span className="loading-strip__line" />
      Refreshing the local workspace…
    </div>
  )
}

function SourcePacketPanel({
  workspace,
  onEvidence,
  onImport,
  importNotice,
}: {
  workspace: WorkspaceView
  onEvidence: (evidence: EvidenceRef) => void
  onImport: () => void
  importNotice?: string
}) {
  const hasFiles = workspace.sourcePacket.files.length > 0 && workspace.status !== 'empty'
  return (
    <section className="panel source-panel" aria-labelledby="source-packet-heading">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Evidence boundary</p>
          <h2 id="source-packet-heading">Source packet</h2>
        </div>
        <div className="panel__header-actions">
          <span className="panel__count">{workspace.sourcePacket.files.length || 0} files</span>
          <button
            type="button"
            className="icon-button"
            onClick={onImport}
            aria-label="Import source packet"
            title="Open desktop source chooser"
          >
            <Icon name="upload" size={15} />
          </button>
        </div>
      </div>
      <p className="panel__intro">
        Only this packet can ground the reconciliation. Document instructions are never treated as
        workflow authority.
      </p>

      {hasFiles ? (
        <div className="source-files" aria-label="Source files">
          {workspace.sourcePacket.files.map((file) => (
            <SourceFileRow key={file.id} file={file} onEvidence={onEvidence} />
          ))}
        </div>
      ) : (
        <div className="empty-import" role="status">
          <span className="empty-import__icon" aria-hidden="true">
            <Icon name="upload" size={20} />
          </span>
          <strong>Import a source packet to begin</strong>
          <p>
            PDF, JSON, CSV, TSV, text, XML, and Markdown files stay in the local sandbox until you
            choose a next action.
          </p>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={onImport}
          >
            <Icon name="upload" size={14} /> Import packet
          </button>
        </div>
      )}
      {importNotice && (
        <p className="import-notice" role="status">
          <Icon name="check" size={14} />
          {importNotice}
        </p>
      )}

      <dl className="packet-details">
        <div>
          <dt>Supplier</dt>
          <dd>{workspace.sourcePacket.supplier}</dd>
        </div>
        <div>
          <dt>Invoice</dt>
          <dd>{workspace.sourcePacket.invoiceNumber}</dd>
        </div>
        <div>
          <dt>Purchase order</dt>
          <dd>{workspace.sourcePacket.purchaseOrder}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{workspace.sourcePacket.receivedAt}</dd>
        </div>
        <div>
          <dt>Packet</dt>
          <dd>
            {workspace.sourcePacket.pageCount} pages ·{' '}
            <code>{workspace.sourcePacket.packetHash}</code>
          </dd>
        </div>
      </dl>
      <div className="source-panel__footer">
        <Icon name="lock" size={13} /> Local read-only snapshot · citations open in context
      </div>
    </section>
  )
}

function SourceFileRow({
  file,
  onEvidence,
}: {
  file: SourceFile
  onEvidence: (evidence: EvidenceRef) => void
}) {
  return (
    <article className="source-file">
      <div className="source-file__topline">
        <span className="source-file__icon" aria-hidden="true">
          <Icon name="file" size={17} />
        </span>
        <div className="source-file__name">
          <strong title={file.name}>{file.name}</strong>
          <small>
            {file.type} · {file.pages} {file.pages === 1 ? 'page' : 'pages'}
          </small>
        </div>
        <span className="source-file__state" aria-label="Source available">
          <Icon name="check" size={14} />
        </span>
      </div>
      <div className="source-file__meta">{file.received}</div>
      {file.evidence.length > 0 && (
        <div className="source-file__citations">
          {file.evidence.map((evidence) => (
            <EvidenceButton key={evidence.id} evidence={evidence} onOpen={onEvidence} />
          ))}
        </div>
      )}
    </article>
  )
}

function StatusBanner({ workspace, onRetry }: { workspace: WorkspaceView; onRetry: () => void }) {
  const status = workspace.status
  const copy: Record<WorkspaceStatus, { title: string; body: string }> = {
    loading: {
      title: 'Loading workspace',
      body: 'Refreshing the case snapshot from the local adapter.',
    },
    ready: {
      title: 'Review is ready',
      body: 'Every decision below is linked to source evidence or policy.',
    },
    warning: {
      title: 'Human review needed',
      body: 'A correction draft can be prepared, but submission remains gated by explicit approval.',
    },
    blocked: {
      title: 'Workflow blocked',
      body: workspace.isPromptInjection
        ? 'An embedded document instruction was quarantined. It did not execute and cannot change policy.'
        : workspace.policy.reason,
    },
    error: {
      title: 'Workspace error',
      body:
        workspace.errorMessage ??
        'The local adapter returned an error. No external action was taken.',
    },
    offline: {
      title: 'Offline AI path',
      body: 'Provider access is unavailable. Local evidence remains visible; no fresh provider result is claimed.',
    },
    'rate-limited': {
      title: 'Provider rate limited',
      body: 'The request was paused. Existing evidence is retained and no automatic retry was sent.',
    },
    'invalid-output': {
      title: 'Invalid model output quarantined',
      body: 'Schema-invalid fields were discarded before reconciliation. Approval and submission remain unavailable.',
    },
    approved: {
      title: 'Approved explicitly',
      body: 'A separate human approval is recorded. Submission is still a distinct, controlled action.',
    },
    executed: {
      title: 'Local mock execution complete',
      body: 'The approved draft was simulated locally. No live supplier system was contacted.',
    },
    empty: {
      title: 'Import required',
      body: 'Add a source packet to create a grounded case workspace.',
    },
  }
  return (
    <div
      className={classNames('status-banner', `status-banner--${status}`)}
      role={status === 'error' || status === 'blocked' ? 'alert' : 'status'}
    >
      <span className="status-banner__icon" aria-hidden="true">
        <Icon name={statusIcon[status]} size={18} />
      </span>
      <div className="status-banner__copy">
        <strong>{copy[status].title}</strong>
        <span>{copy[status].body}</span>
      </div>
      {(status === 'error' ||
        status === 'offline' ||
        status === 'rate-limited' ||
        status === 'invalid-output') && (
        <button type="button" className="button button--small button--quiet" onClick={onRetry}>
          <Icon name="refresh" size={13} /> Retry local check
        </button>
      )}
    </div>
  )
}

function ReconciliationPanel({
  workspace,
  onEvidence,
  onRetry,
}: {
  workspace: WorkspaceView
  onEvidence: (evidence: EvidenceRef) => void
  onRetry: () => void
}) {
  const semanticMapping = workspace.comparisons.find(
    (comparison) => comparison.matchMethod === 'semantic_suggestion',
  )
  return (
    <section className="panel reconcile-panel" aria-labelledby="reconciliation-heading">
      <div className="panel__header panel__header--reconcile">
        <div>
          <p className="eyebrow">Decision surface</p>
          <h2 id="reconciliation-heading">Reconciliation review</h2>
        </div>
        <StatusBadge status={workspace.status} />
      </div>
      <StatusBanner workspace={workspace} onRetry={onRetry} />

      {workspace.scenarioId === 'semantic-match' && (
        <div
          className={classNames(
            'semantic-review',
            semanticMapping ? 'semantic-review--proposed' : 'semantic-review--escalated',
          )}
          role="status"
        >
          <div className="semantic-review__icon" aria-hidden="true">
            <Icon name={semanticMapping ? 'check' : 'warning'} size={16} />
          </div>
          <div>
            <strong>
              {semanticMapping ? 'AI-proposed mapping' : 'Semantic mapping requires escalation'}
            </strong>
            {semanticMapping ? (
              <p>
                {semanticMapping.description} · confidence{' '}
                {semanticMapping.confidence ?? 'not provided'} · deterministic verification{' '}
                {semanticMapping.verification ?? 'not run'}.
                {semanticMapping.evidence && (
                  <>
                    {' '}
                    <EvidenceButton evidence={semanticMapping.evidence} onOpen={onEvidence} />
                  </>
                )}
              </p>
            ) : (
              <p>
                Offline mode does not infer a mapping from wording alone. Select the provider mode
                to request a bounded suggestion, then verify it against quantity, price, and source
                evidence.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="reconcile-overview">
        <div className="overview-block">
          <span className="overview-label">What happened</span>
          <p>{workspace.happened}</p>
        </div>
        <div className="overview-block">
          <span className="overview-label">Why it matters</span>
          <p>{workspace.why}</p>
        </div>
      </div>

      <div className="subsection-heading">
        <h3>Line comparison</h3>
        <span>Invoice ↔ approved order</span>
      </div>
      <ComparisonTable comparisons={workspace.comparisons} onEvidence={onEvidence} />

      <div className="facts-policy-grid">
        <section className="inner-section" aria-labelledby="facts-heading">
          <div className="subsection-heading">
            <h3 id="facts-heading">Extracted facts</h3>
            <span>Source-grounded</span>
          </div>
          <div className="facts-list">
            {workspace.extractedFacts.map((fact) => (
              <div className="fact-row" key={fact.id}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
                <span className="fact-confidence">{fact.confidence}</span>
                {fact.evidence && <EvidenceButton evidence={fact.evidence} onOpen={onEvidence} />}
              </div>
            ))}
          </div>
        </section>
        <section className="inner-section policy-section" aria-labelledby="policy-heading">
          <div className="subsection-heading">
            <h3 id="policy-heading">Policy gate</h3>
            <Icon name="shield" size={15} />
          </div>
          <p className="policy-name">{workspace.policy.policyName}</p>
          <p className="policy-reason">{workspace.policy.reason}</p>
          <div className="policy-meta">
            <span>Checked {workspace.policy.lastChecked}</span>
            <span>
              {workspace.policy.approvalRequired ? 'Approval required' : 'No approval required'}
            </span>
          </div>
        </section>
      </div>

      {workspace.draft && <DraftSummary workspace={workspace} />}
      {workspace.approval.status === 'approved' && (
        <div className="approval-summary">
          <Icon name="user-check" size={16} />
          <span>
            <strong>Approved by {workspace.approval.approvedBy ?? 'local operator'}</strong>
            <small>
              {workspace.approval.approvedAt ?? 'Just now'} · submission remains separate
            </small>
          </span>
        </div>
      )}
      {workspace.execution.status === 'succeeded' && (
        <div className="execution-summary">
          <Icon name="check" size={16} />
          <span>
            <strong>Local/mock adapter succeeded</strong>
            <small>{workspace.execution.message}</small>
          </span>
        </div>
      )}
    </section>
  )
}

function ComparisonTable({
  comparisons,
  onEvidence,
}: {
  comparisons: LineComparisonView[]
  onEvidence: (evidence: EvidenceRef) => void
}) {
  return (
    <div className="comparison-table-wrap">
      <table className="comparison-table">
        <caption className="sr-only">Invoice and approved order line comparison</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Invoice</th>
            <th scope="col">Approved order</th>
            <th scope="col">Variance</th>
            <th scope="col">
              <span className="sr-only">Decision</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((comparison) => (
            <tr key={comparison.id} className={classNames(`comparison-row--${comparison.status}`)}>
              <th scope="row">
                <span className="line-description">{comparison.description}</span>
                <small>
                  {comparison.sku} · Qty {comparison.quantity}
                </small>
              </th>
              <td>{comparison.invoiceValue}</td>
              <td>{comparison.expectedValue}</td>
              <td>
                <span className={classNames('variance', `variance--${comparison.status}`)}>
                  {comparison.variance}
                </span>
              </td>
              <td>
                <div className="row-decision">
                  <span
                    className={classNames('decision-dot', `decision-dot--${comparison.status}`)}
                    aria-hidden="true"
                  />{' '}
                  <span>
                    {comparison.status === 'match'
                      ? 'Match'
                      : comparison.status === 'blocked'
                        ? 'Blocked'
                        : comparison.status === 'review'
                          ? 'Review'
                          : 'Unknown'}
                  </span>
                  {comparison.evidence && (
                    <EvidenceButton evidence={comparison.evidence} onOpen={onEvidence} />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DraftSummary({ workspace }: { workspace: WorkspaceView }) {
  if (!workspace.draft) return null
  return (
    <section className="draft-summary" aria-labelledby="draft-summary-heading">
      <div className="draft-summary__heading">
        <span className="draft-summary__icon" aria-hidden="true">
          <Icon name="clipboard" size={16} />
        </span>
        <div>
          <h3 id="draft-summary-heading">{workspace.draft.title}</h3>
          <small>
            {workspace.draft.id} · {workspace.draft.createdAt}
          </small>
        </div>
        <span className="draft-status">{workspace.draft.status}</span>
      </div>
      <p>{workspace.draft.summary}</p>
      {workspace.draft.changes.length > 0 && (
        <ul>
          {workspace.draft.changes.map((change) => (
            <li key={change}>
              <Icon name="check" size={13} />
              {change}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AgentRunPanel({
  workspace,
  providerMode,
  apiAvailable,
  onTrace,
  onRetry,
}: {
  workspace: WorkspaceView
  providerMode: ProviderMode
  apiAvailable: boolean
  onTrace: (trace: TraceEventView) => void
  onRetry: () => void
}) {
  const providerSelected = providerMode === 'provider'
  const providerEvidence = workspace.providerCallObserved
    ? `Provider result observed · ${workspace.providerCalls} call${workspace.providerCalls === 1 ? '' : 's'}`
    : 'No provider result observed for this run'
  const providerReadiness = !apiAvailable
    ? 'Provider configuration unavailable: desktop bridge not present'
    : workspace.providerCallObserved
      ? 'Provider configuration evidenced by this run'
      : 'Provider configuration not evidenced by workspace or trace'
  const deterministicScenario =
    workspace.scenarioId === 'clean-match' || workspace.scenarioId === 'price-mismatch'
  return (
    <section className="panel agent-panel" aria-labelledby="agent-run-heading">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Observability</p>
          <h2 id="agent-run-heading">Agent run</h2>
        </div>
        <span className="run-state">
          <span className="run-state__dot" aria-hidden="true" />{' '}
          {workspace.execution.status === 'succeeded' ? 'Complete' : 'Captured'}
        </span>
      </div>
      <div className="agent-disclosure">
        <div className="agent-disclosure__icon" aria-hidden="true">
          <Icon name="shield" size={17} />
        </div>
        <div>
          <strong>{workspace.providerLabel}</strong>
          <p>
            {deterministicScenario
              ? 'AI not needed for this scenario. Deterministic controls compare the typed source facts; no provider call is expected.'
              : providerSelected
                ? `DeepSeek provider mode is selected. Bounded document excerpts may leave this device when the configured bridge runs. ${providerEvidence}; payloads and auth headers never appear in this UI.`
                : 'Offline mode is selected. Document excerpts are not sent to DeepSeek; the local path may escalate when semantic mapping is required.'}
          </p>
          <small className="provider-readiness" role="status">
            {apiAvailable
              ? 'Desktop bridge available'
              : 'Desktop bridge unavailable in this browser'}{' '}
            · {providerReadiness} · {providerEvidence}
          </small>
        </div>
      </div>
      {workspace.scenarioId === 'semantic-match' && (
        <div
          className={classNames(
            'semantic-run-note',
            providerSelected && 'semantic-run-note--provider',
          )}
        >
          <Icon name={providerSelected ? 'check' : 'warning'} size={15} />
          <span>
            {providerSelected
              ? 'Provider-assisted mapping is allowed; deterministic quantity, price, and evidence checks still decide the match.'
              : 'Offline semantic mapping is intentionally escalated. No mapping is inferred without a provider suggestion.'}
          </span>
        </div>
      )}
      {(workspace.status === 'offline' || workspace.status === 'rate-limited') && (
        <div className="agent-alert">
          <Icon name="warning" size={15} />
          <span>
            {workspace.errorMessage ??
              'The optional provider path is unavailable; local evidence is retained.'}
          </span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      <div className="trace-list" aria-label="Run timeline">
        {workspace.trace.map((event) => (
          <TraceRow key={event.id} event={event} onOpen={onTrace} />
        ))}
      </div>
      <div className="next-action">
        <span className="overview-label">Safe next action</span>
        <p>{workspace.safeNextAction}</p>
      </div>
      <details className="evaluation-details">
        <summary>
          <span>
            Evaluation evidence
            {!workspace.evaluation && ' · Not measured for this run'}
          </span>
          <Icon name="chevron-down" size={14} />
        </summary>
        {workspace.evaluation ? (
          <>
            <p className="evaluation-summary">
              {workspace.evaluation.sampleSize} observed sample
              {workspace.evaluation.sampleSize === 1 ? '' : 's'} ·{' '}
              {workspace.evaluation.evaluationId}
            </p>
            <dl>
              {workspace.evaluation.metrics.map((metric) => (
                <div key={metric.metric}>
                  <dt>{metric.label}</dt>
                  <dd>
                    {metric.value} <small>{metric.unit}</small>
                  </dd>
                  <small>
                    {metric.observed ? 'Observed' : 'Not observed'} · n={metric.sampleSize}
                  </small>
                </div>
              ))}
            </dl>
            <small>
              Generated {workspace.evaluation.generatedAt} · {workspace.evaluation.modelCalls} model
              call
              {workspace.evaluation.modelCalls === 1 ? '' : 's'} · {workspace.evaluation.retries}{' '}
              retr{workspace.evaluation.retries === 1 ? 'y' : 'ies'}
            </small>
          </>
        ) : (
          <p className="evaluation-empty">Not measured for this run.</p>
        )}
      </details>
      <div className="agent-panel__footer">
        <Icon name="lock" size={13} /> Trace details are progressive disclosure; sensitive payloads
        are redacted.
      </div>
    </section>
  )
}

function TraceRow({
  event,
  onOpen,
}: {
  event: TraceEventView
  onOpen: (event: TraceEventView) => void
}) {
  return (
    <button
      type="button"
      className={classNames('trace-row', `trace-row--${event.status}`)}
      onClick={() => onOpen(event)}
    >
      <span
        className={classNames('trace-row__marker', `trace-row__marker--${event.status}`)}
        aria-hidden="true"
      >
        <span />
      </span>
      <span className="trace-row__time">{event.time}</span>
      <span className="trace-row__body">
        <strong>{event.title}</strong>
        <small>{event.summary}</small>
      </span>
      <Icon name="arrow-right" size={14} />
    </button>
  )
}

function ActionBar({
  workspace,
  isLoading,
  isMutating,
  onRequestCorrection,
  onInspectTrace,
  onCreateDraft,
  onApprove,
  onSubmit,
}: {
  workspace: WorkspaceView
  isLoading: boolean
  isMutating: boolean
  onRequestCorrection: () => void
  onInspectTrace: () => void
  onCreateDraft: () => void
  onApprove: () => void
  onSubmit: () => void
}) {
  const hardBlocked =
    workspace.isPromptInjection ||
    workspace.status === 'error' ||
    workspace.status === 'invalid-output' ||
    workspace.status === 'rate-limited'
  const busy = isLoading || isMutating
  const canDraft = Boolean(
    !busy &&
      !hardBlocked &&
      workspace.status !== 'empty' &&
      !workspace.draft &&
      workspace.policy.canCreateDraft,
  )
  const canApprove = Boolean(
    !busy &&
      !hardBlocked &&
      workspace.draft &&
      workspace.draft.status === 'ready' &&
      workspace.policy.canApprove &&
      workspace.approval.status !== 'approved',
  )
  const canSubmit = Boolean(
    !busy &&
      !hardBlocked &&
      workspace.approval.status === 'approved' &&
      workspace.policy.canSubmit &&
      workspace.execution.status !== 'succeeded',
  )
  return (
    <div className="action-bar" role="region" aria-label="Case actions">
      <div className="action-bar__context">
        <span className="action-bar__context-dot" aria-hidden="true" />
        <span>
          {workspace.approval.status === 'approved'
            ? 'Approval recorded · submission is separate'
            : workspace.policy.reason}
        </span>
      </div>
      <div className="action-bar__buttons">
        <button
          type="button"
          className="button button--quiet"
          onClick={onRequestCorrection}
          disabled={
            busy || hardBlocked || workspace.status === 'empty' || workspace.correctionRequested
          }
          title={hardBlocked ? 'This state cannot request a correction automatically.' : undefined}
        >
          <Icon name="alert" size={15} />
          {workspace.correctionRequested ? 'Correction requested' : 'Request correction'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={onInspectTrace}
          disabled={isLoading}
        >
          <Icon name="activity" size={15} />
          Inspect trace
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={onCreateDraft}
          disabled={!canDraft}
          title={
            !canDraft && !workspace.draft
              ? hardBlocked
                ? 'Blocked until the case is safe to continue.'
                : 'Create a grounded correction draft first.'
              : undefined
          }
        >
          <Icon name="clipboard" size={15} />
          {workspace.draft ? 'Draft created' : 'Create corrected draft'}
        </button>
        <span className="action-bar__separator" aria-hidden="true" />
        <button
          type="button"
          className="button button--primary"
          onClick={onApprove}
          disabled={!canApprove}
          title={
            !canApprove ? 'A review-ready draft and policy permission are required.' : undefined
          }
        >
          <Icon name="user-check" size={15} />
          Approve explicitly
        </button>
        <button
          type="button"
          className="button button--submit"
          onClick={onSubmit}
          disabled={!canSubmit}
          title={
            !canSubmit ? 'Submit is enabled only after separate explicit approval.' : undefined
          }
        >
          <Icon name="arrow-right" size={15} />
          Submit · local/mock
        </button>
      </div>
    </div>
  )
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceRef; onClose: () => void }) {
  return (
    <DialogShell title="Evidence" onClose={onClose} drawer>
      <div className="evidence-context">
        <span className="evidence-context__icon" aria-hidden="true">
          <Icon name="file" size={17} />
        </span>
        <div>
          <strong>{evidence.fileName}</strong>
          <span>
            Page {evidence.page} · {evidence.kind} evidence
          </span>
        </div>
      </div>
      <div className="evidence-page">
        <span className="evidence-page__label">Page {evidence.page}</span>
        <div className="evidence-quote">“{evidence.quote}”</div>
        <div className="evidence-highlight" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="evidence-note">
        <Icon name="info" size={15} />
        <p>
          This citation is a focused source excerpt. It can support a decision, but it cannot issue
          workflow instructions or override policy.
        </p>
      </div>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </DialogShell>
  )
}

function TraceDrawer({ trace, onClose }: { trace: TraceEventView[]; onClose: () => void }) {
  return (
    <DialogShell title="Run trace" onClose={onClose} wide>
      <p className="dialog-intro">
        A chronological record of local processing, policy checks, and human actions. Sensitive
        provider payloads and auth material are intentionally omitted.
      </p>
      <div className="trace-drawer-list">
        {trace.map((event) => (
          <article
            className={classNames('trace-detail', `trace-detail--${event.status}`)}
            key={event.id}
          >
            <div className="trace-detail__heading">
              <span className="trace-detail__marker" aria-hidden="true" />
              <div>
                <strong>{event.title}</strong>
                <small>
                  {event.time} · {event.kind}
                </small>
              </div>
              <StatusPill status={event.status} />
            </div>
            <p>{event.detail}</p>
            {event.safeDetail && (
              <div className="redaction-note">
                <Icon name="lock" size={13} />
                {event.safeDetail}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onClose}>
          Close trace
        </button>
      </div>
    </DialogShell>
  )
}

function StatusPill({ status }: { status: TraceEventView['status'] }) {
  const labels = {
    complete: 'Complete',
    attention: 'Attention',
    blocked: 'Blocked',
    pending: 'Pending',
  }
  return <span className={classNames('trace-pill', `trace-pill--${status}`)}>{labels[status]}</span>
}

function ApprovalDialog({
  onConfirm,
  onClose,
  isMutating,
  workspace,
}: {
  onConfirm: () => void
  onClose: () => void
  isMutating: boolean
  workspace: WorkspaceView
}) {
  return (
    <DialogShell title="Confirm explicit approval" onClose={onClose}>
      <div className="approval-dialog__notice">
        <Icon name="user-check" size={20} />
        <div>
          <strong>You are approving this correction draft.</strong>
          <p>
            This is a separate human decision. Nothing will be submitted until you choose the
            distinct Submit action.
          </p>
        </div>
      </div>
      <dl className="approval-checklist">
        <div>
          <dt>Case</dt>
          <dd>
            {workspace.caseNumber} · {workspace.supplier}
          </dd>
        </div>
        <div>
          <dt>Draft</dt>
          <dd>{workspace.draft?.id ?? 'No draft'}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>{workspace.policy.policyName}</dd>
        </div>
        <div>
          <dt>Adapter</dt>
          <dd>local/mock · not live</dd>
        </div>
      </dl>
      <div className="dialog__actions">
        <button
          type="button"
          className="button button--quiet"
          onClick={onClose}
          disabled={isMutating}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={onConfirm}
          disabled={isMutating}
        >
          <Icon name="user-check" size={15} />
          {isMutating ? 'Recording…' : 'Confirm approval'}
        </button>
      </div>
    </DialogShell>
  )
}

export function SupplierOpsApp({ api, initialScenarioId }: SupplierOpsAppProps) {
  const state = useSupplierOps({ api, initialScenarioId })
  const [activeEvidence, setActiveEvidence] = useState<EvidenceRef>()
  const [traceOpen, setTraceOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [importNotice, setImportNotice] = useState<string>()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    return () => {
      delete document.documentElement.dataset.theme
    }
  }, [theme])

  const workspace = state.workspace
  const onImport = () => {
    if (!state.apiAvailable) {
      setImportNotice(
        'Import is available in the desktop app; this browser preview has no chooser bridge.',
      )
      return
    }
    setImportNotice('Opening the desktop source chooser…')
    void state.importSourcePacket().then(() => {
      setImportNotice(
        'Desktop chooser request completed; only an accepted packet updates this workspace.',
      )
      window.setTimeout(() => setImportNotice(undefined), 5000)
    })
  }
  const onApprove = () => {
    if (workspace.draft && workspace.policy.canApprove && !workspace.isPromptInjection)
      setApprovalOpen(true)
  }
  const confirmApproval = async () => {
    await state.approve()
    setApprovalOpen(false)
  }

  return (
    <AppErrorBoundary>
      <div className="app-shell">
        <TopBar
          workspace={workspace}
          scenarioId={state.scenarioId}
          apiAvailable={state.apiAvailable}
          providerMode={state.providerMode}
          onProviderMode={state.setProviderMode}
          onRun={() => void state.runScenario()}
          isRunning={state.isLoading || state.isMutating}
          onScenario={state.setScenario}
          onReplay={() => void state.replay()}
          onSave={() => void state.saveRegression()}
          regressionSaved={workspace.regressionSaved}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
        />
        <LoadingStrip isLoading={state.isLoading} />
        <main className="workspace" aria-label="Supplier exception workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">Case workspace · {SCENARIO_META[state.scenarioId].label}</p>
              <h1>{workspace.caseTitle}</h1>
              <p className="workspace-heading__sub">{workspace.headline}</p>
            </div>
            <div className="workspace-heading__meta">
              <span className="case-id">{workspace.id}</span>
              <span>
                {workspace.updatedAt.startsWith('Revision ')
                  ? workspace.updatedAt
                  : `Updated ${workspace.updatedAt}`}
              </span>
            </div>
          </div>
          <WorkflowRail workspace={workspace} />
          <div className="workspace-grid">
            <SourcePacketPanel
              workspace={workspace}
              onEvidence={setActiveEvidence}
              onImport={onImport}
              importNotice={importNotice}
            />
            <ReconciliationPanel
              workspace={workspace}
              onEvidence={setActiveEvidence}
              onRetry={() => void state.retry()}
            />
            <AgentRunPanel
              workspace={workspace}
              providerMode={state.providerMode}
              apiAvailable={state.apiAvailable}
              onTrace={() => setTraceOpen(true)}
              onRetry={() => void state.retry()}
            />
          </div>
        </main>
        <ActionBar
          workspace={workspace}
          isLoading={state.isLoading}
          isMutating={state.isMutating}
          onRequestCorrection={() => void state.requestCorrection()}
          onInspectTrace={() => setTraceOpen(true)}
          onCreateDraft={() => void state.createCorrectedDraft()}
          onApprove={onApprove}
          onSubmit={() => void state.submit()}
        />
        {state.error && (
          <div className="toast toast--error" role="alert">
            <Icon name="alert" size={15} />
            {state.error}
          </div>
        )}
        {activeEvidence && (
          <EvidenceDrawer evidence={activeEvidence} onClose={() => setActiveEvidence(undefined)} />
        )}
        {traceOpen && <TraceDrawer trace={workspace.trace} onClose={() => setTraceOpen(false)} />}
        {approvalOpen && (
          <ApprovalDialog
            workspace={workspace}
            isMutating={state.isMutating}
            onClose={() => setApprovalOpen(false)}
            onConfirm={() => void confirmApproval()}
          />
        )}
      </div>
    </AppErrorBoundary>
  )
}

export const App = SupplierOpsApp
export default SupplierOpsApp
