import { getSchema, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
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

/** An empty document. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
