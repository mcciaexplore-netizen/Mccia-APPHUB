import "server-only";
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { eruSchema } from "./editor/extensions";
import { decidedDoc } from "./editor/track-changes";

/**
 * Editor content (the same JSON the editor saves) as a PDF, for "Convert to PDF". Like the .docx export, pending tracked changes read as
 * accepted and comments are left out. Carried over: headings 1-3, bold, italic, underline, strike-through, links, bullet and numbered lists
 * (nested), quotes, code, line breaks, dividers and tables. Text colour, fonts and pictures are not. The built-in PDF font (Helvetica) has
 * Latin letters only; other scripts may not show.
 *
 * `slides`: content made from a PowerPoint (convert.ts slidesToDoc, one section per slide under a level-2 heading) becomes one landscape
 * page per slide.
 */

type J = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: J[] };

const s = StyleSheet.create({
  page: { paddingVertical: 48, paddingHorizontal: 52, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.45, color: "#111827" },
  slide: { paddingVertical: 40, paddingHorizontal: 48, fontSize: 14, fontFamily: "Helvetica", lineHeight: 1.4, color: "#111827" },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 6 },
  h2: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 5 },
  h3: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 4 },
  slideTitle: { fontSize: 24, fontFamily: "Helvetica-Bold", marginBottom: 14, color: "#0f4c75" },
  p: { marginBottom: 6 },
  li: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 16 },
  quote: { borderLeftWidth: 3, borderLeftColor: "#cbd5e1", paddingLeft: 10, marginBottom: 6, color: "#374151" },
  code: { fontFamily: "Courier", fontSize: 9.5, backgroundColor: "#f3f4f6", padding: 6, marginBottom: 6 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#d1d5db", marginVertical: 8 },
  table: { borderWidth: 1, borderColor: "#cbd5e1", marginBottom: 8 },
  row: { flexDirection: "row" },
  cell: { flex: 1, borderWidth: 0.5, borderColor: "#cbd5e1", padding: 4 },
  head: { backgroundColor: "#f1f5f9", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 20, left: 52, right: 52, fontSize: 8, color: "#9ca3af", textAlign: "right" },
});

/** The built-in font that has the run's weight and slant. */
function fontFor(marks: J["marks"]): string {
  const has = (t: string) => !!marks?.some((m) => m.type === t);
  const b = has("bold");
  const i = has("italic");
  if (has("code")) return "Courier";
  return b && i ? "Helvetica-BoldOblique" : b ? "Helvetica-Bold" : i ? "Helvetica-Oblique" : "Helvetica";
}

function inline(nodes: J[] | undefined, key = ""): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === "hardBreak") return "\n";
    if (n.type !== "text") return null;
    const decoration = [n.marks?.some((m) => m.type === "underline") ? "underline" : "", n.marks?.some((m) => m.type === "strike") ? "line-through" : ""].filter(Boolean).join(" ");
    const style = { fontFamily: fontFor(n.marks), ...(decoration ? { textDecoration: decoration as "underline" } : {}) };
    const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
    if (typeof href === "string" && /^(https?:|mailto:)/i.test(href))
      return (
        <Link key={`${key}${i}`} src={href} style={{ ...style, color: "#1d4ed8" }}>
          {n.text}
        </Link>
      );
    return (
      <Text key={`${key}${i}`} style={style}>
        {n.text}
      </Text>
    );
  });
}

function list(n: J, depth: number, ordered: boolean, key: string): ReactNode {
  return (
    <View key={key} style={{ marginLeft: depth * 14, marginBottom: 4 }}>
      {(n.content ?? []).map((li, i) => (
        <View key={`${key}-${i}`} wrap={false}>
          {(li.content ?? []).map((child, j) =>
            j === 0 && child.type === "paragraph" ? (
              <View key={j} style={s.li}>
                <Text style={s.bullet}>{ordered ? `${Number(n.attrs?.start ?? 1) + i}.` : "•"}</Text>
                <Text style={{ flex: 1 }}>{inline(child.content, `${key}-${i}-`)}</Text>
              </View>
            ) : (
              block(child, `${key}-${i}-${j}`, depth + 1)
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function block(n: J, key: string, depth = 0, slides = false): ReactNode {
  switch (n.type) {
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      return (
        <Text key={key} style={slides && level === 2 ? s.slideTitle : level === 1 ? s.h1 : level === 2 ? s.h2 : s.h3} minPresenceAhead={24}>
          {inline(n.content, `${key}-`)}
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text key={key} style={s.p}>
          {inline(n.content, `${key}-`)}
        </Text>
      );
    case "bulletList":
      return list(n, depth, false, key);
    case "orderedList":
      return list(n, depth, true, key);
    case "blockquote":
      return (
        <View key={key} style={s.quote}>
          {(n.content ?? []).map((c, i) => block(c, `${key}-${i}`, depth))}
        </View>
      );
    case "codeBlock":
      return (
        <Text key={key} style={s.code}>
          {(n.content ?? []).map((t) => t.text ?? "").join("")}
        </Text>
      );
    case "horizontalRule":
      return <View key={key} style={s.hr} />;
    case "table":
      return (
        <View key={key} style={s.table}>
          {(n.content ?? []).map((row, r) => (
            <View key={r} style={s.row} wrap={false}>
              {(row.content ?? []).map((cell, c) => (
                <View key={c} style={[s.cell, ...(cell.type === "tableHeader" ? [s.head] : []), { flex: Number(cell.attrs?.colspan ?? 1) || 1 }]}>
                  {(cell.content ?? []).map((cc, k) => block(cc, `${key}-${r}-${c}-${k}`, depth))}
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return n.content ? <View key={key}>{n.content.map((c, i) => block(c, `${key}-${i}`, depth))}</View> : null;
  }
}

/** The PDF for editor content. */
export async function exportPdf(title: string, content: unknown, opts: { slides?: boolean } = {}): Promise<Buffer> {
  const schema = eruSchema();
  const { doc } = decidedDoc(schema.nodeFromJSON(content), null, "accept");
  const top = (doc.toJSON() as J).content ?? [];
  let pages: ReactNode[];
  if (opts.slides) {
    // One landscape page per slide: a new page at every level-2 heading (a slide's title).
    const groups: J[][] = [];
    for (const n of top) {
      if (n.type === "heading" && Number(n.attrs?.level) === 2) groups.push([n]);
      else (groups.at(-1) ?? groups[groups.push([]) - 1]).push(n);
    }
    pages = groups.map((g, i) => (
      <Page key={i} size="A4" orientation="landscape" style={s.slide}>
        {g.map((n, j) => block(n, `${i}-${j}`, 0, true))}
        <Text style={s.footer} fixed>{`${i + 1} / ${groups.length}`}</Text>
      </Page>
    ));
  } else {
    pages = [
      <Page key="p" size="A4" style={s.page}>
        {top.map((n, i) => block(n, String(i)))}
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${title} · ${pageNumber} / ${totalPages}`} />
      </Page>,
    ];
  }
  return renderToBuffer(
    <Document title={title} creator="MCCIA App Hub · ERU" producer="MCCIA App Hub">
      {pages}
    </Document>,
  );
}
