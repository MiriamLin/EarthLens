import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { AlertIcon } from './Icons'

type Props = {
  label: string
  children: ReactNode
  page?: boolean
  resetKey?: unknown
}

type State = {
  error: Error | null
  attempt: number
  resetKey: unknown
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} failed`, error, info.componentStack)
  }

  reload = () => {
    if (this.props.page) {
      window.location.reload()
      return
    }
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))
  }

  render() {
    if (!this.state.error) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
    return (
      <div role="alert" className={`flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 ${this.props.page ? 'h-dvh bg-surface' : ''}`}>
        <div className="card flex max-w-sm flex-col items-center gap-3 px-6 py-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger">
            <AlertIcon size={20} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{this.props.label} stopped working</p>
            <p className="mt-1 text-xs break-words text-subtle">{this.state.error.message}</p>
          </div>
          <button type="button" onClick={this.reload} className="btn btn-primary btn-sm">
            {this.props.page ? 'Reload page' : 'Reload'}
          </button>
        </div>
      </div>
    )
  }
}
