/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE RENDERER'S LAST LINE OF DEFENCE, added 08-12-2026 after one line in NotesView blanked the
// entire application.
//
// WHAT HAPPENED, because it is the whole justification for this file: a lazy useState initializer
// read a variable declared eleven lines below it. That is a temporal-dead-zone throw, TypeScript
// cannot see it inside an arrow function, and React's default behaviour when a render throws with
// no boundary above it is to UNMOUNT THE ENTIRE TREE. So a one-line mistake in the notes list
// produced a completely white window with no message, no console breadcrumb the user would find,
// and nothing to distinguish it from a dead application.
//
// A boundary turns that into a contained failure: the rest of the vault keeps working, the surface
// that broke says so in a plain sentence, and the technical detail goes to the SAME event log as
// every main-side failure — carrying a VLT- reference, so a renderer crash and an IPC error are
// looked up exactly the same way.
//
// It is a class component because React has no hook equivalent — componentDidCatch has no
// functional form, and this is the one place in the module where that is true.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { vaultApi } from "./vaultApi";

interface Props {
  /** Named so the message can say WHICH surface failed rather than "something went wrong". */
  surface: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  reference: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reference: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Straight to the vault's own log, so it appears beside every other failure with a reference the
    // user can quote. Best effort: if the bridge is what broke, the console still has it.
    try {
      void vaultApi()
        .logClient("error", `${this.props.surface} crashed: ${error.message}`, `${error.stack ?? ""}\n\nComponent stack:${info.componentStack ?? ""}`)
        .then((reference) => this.setState({ reference }))
        .catch(() => undefined);
    } catch {
      /* never throw from the thing that catches throws */
    }
    console.error(`[vault] ${this.props.surface} crashed:`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error, reference } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="vault-state error" style={{ textAlign: "left", margin: 16 }}>
        <b>{this.props.surface} could not be drawn.</b>
        <p style={{ marginTop: 6 }}>
          The rest of the vault is still working — switch to another tab and back, and this section will try again.
          Nothing was lost: this is a display failure, not a write.
        </p>
        {reference && (
          <p className="vault-hint" style={{ marginTop: 6 }}>
            Reference <b>{reference}</b> — it is in Settings under Activity and errors, with the technical detail.
          </p>
        )}
        <div style={{ marginTop: 10 }}>
          <button className="vault-btn" onClick={() => this.setState({ error: null, reference: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
