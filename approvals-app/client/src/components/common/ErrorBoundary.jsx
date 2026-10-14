import { Component } from "react";

/**
 * Catches a crash while drawing a page and shows a message with a way back, instead of a blank screen.
 * `resetKey` changes when the person navigates, which clears the error so the next page gets a fresh start.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() { return { failed: true }; }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="max-w-xl rounded border border-red-300 bg-red-50 p-5 text-red-900" role="alert">
        <p className="font-bold">Something went wrong on this page.</p>
        <p className="mt-1 text-sm">Your work on the server is safe. Go back to the home page and try again; if it keeps happening, tell the administrator.</p>
        <a href="/" className="btn btn-primary mt-3">Back to the home page</a>
      </div>
    );
  }
}
