"use client";

import dynamic from "next/dynamic";
import type { EditorProps } from "./DocumentEditor";

/** The editor (TipTap and its extensions) loads only on the document page, in the browser. */
const DocumentEditor = dynamic(() => import("./DocumentEditor"), {
  ssr: false,
  loading: () => <p className="eru-root p-8 text-center eru-muted">Loading the editor…</p>,
});

export function EditorLoader(props: EditorProps) {
  return <DocumentEditor {...props} />;
}
