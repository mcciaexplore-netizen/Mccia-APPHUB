import { getSchema, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import type { Schema } from "@tiptap/pm/model";
import { DeletionMark, InsertionMark, TrackChanges } from "./track-changes";
import { CommentMark, Comments } from "./comments";

/**
 * The document editor's features, in one list shared by the browser (the editor and the .docx import), the server (checking what is saved,
 * applying reviews, the .docx export) and the unit tests, so all three agree on what a document can contain. No DOM is needed to build the
 * schema.
 */
export function eruExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Typography,
    // Tables (from a .docx import, a PowerPoint table, or inserted here), with columns resizable by dragging their edge.
    Table.configure({ resizable: true, HTMLAttributes: { class: "eru-table" } }),
    TableRow,
    TableHeader,
    TableCell,
    InsertionMark,
    DeletionMark,
    CommentMark,
    TrackChanges,
    Comments,
  ];
}

let schema: Schema | null = null;
/** The document schema (built once). */
export function eruSchema(): Schema {
  return (schema ??= getSchema(eruExtensions()));
}

/**
 * The editor's JSON as plain data. ProseMirror builds node and mark attributes as prototype-less objects (Object.create(null)), which React
 * does not send to or from a server action as data (they arrive as opaque references), so content is passed through this both ways.
 */
export const plainContent = <T,>(content: T): T => JSON.parse(JSON.stringify(content)) as T;

/** An empty document. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
