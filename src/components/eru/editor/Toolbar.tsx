"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  MessageSquarePlus,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { CODE_LOCKED_MESSAGE, touchesCodeBlock } from "@/lib/eru/editor/track-changes";

/** The editor's formatting bar: font and size, bold to strike-through, colours, alignment, lists, headings, quote and code, undo/redo, comment. */

const FONTS = [
  { label: "Default font", value: "" },
  { label: "Calibri", value: "Calibri, Carlito, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Courier New", value: "\"Courier New\", monospace" },
];
const SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36"];
export const NO_CODE_COMMENTS = "Comments cannot be added to code blocks.";

/**
 * One button. `blocked` (a reason) shows it switched off but still answers a click with the reason, and keeps the reason as its tooltip:
 * a truly disabled button shows no tooltip in some browsers.
 */
function Tool({ icon: Icon, label, on, disabled, blocked, onBlocked, onClick, children }: { icon?: LucideIcon; label: string; on?: boolean; disabled?: boolean; blocked?: string | null; onBlocked?: (reason: string) => void; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      className="eru-tool"
      aria-label={blocked ? `${label}: ${blocked}` : label}
      title={blocked ?? label}
      aria-pressed={on === undefined ? undefined : on}
      aria-disabled={blocked ? true : undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (blocked ? onBlocked?.(blocked) : onClick())}
    >
      {Icon ? <Icon size={16} aria-hidden /> : children}
    </button>
  );
}

const Sep = () => <span className="eru-tool-sep" aria-hidden />;

export function Toolbar({ editor, trackOn, onComment, onBlocked }: { editor: Editor; trackOn: boolean; onComment: () => void; onBlocked: (reason: string) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes("textStyle");
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        quote: e.isActive("blockquote"),
        code: e.isActive("codeBlock"),
        left: e.isActive({ textAlign: "left" }),
        center: e.isActive({ textAlign: "center" }),
        right: e.isActive({ textAlign: "right" }),
        justify: e.isActive({ textAlign: "justify" }),
        font: (style.fontFamily as string | undefined) ?? "",
        size: ((style.fontSize as string | undefined) ?? "").replace(/pt$/, ""),
        color: (style.color as string | undefined) ?? "#111827",
        highlight: (e.getAttributes("highlight").color as string | undefined) ?? "#fde047",
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        hasSelection: !e.state.selection.empty,
        inCode: touchesCodeBlock(e.state.doc, e.state.selection.from, e.state.selection.to),
      };
    },
  });
  const c = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5" role="toolbar" aria-label="Formatting">
      <select
        className="eru-tool-select max-w-[9.5rem]"
        aria-label="Font"
        value={FONTS.some((f) => f.value === s.font) ? s.font : ""}
        onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select className="eru-tool-select w-[4.6rem]" aria-label="Font size (points)" value={SIZES.includes(s.size) ? s.size : ""} onChange={(e) => (e.target.value ? c().setFontSize(`${e.target.value}pt`).run() : c().unsetFontSize().run())}>
        <option value="">Size</option>
        {SIZES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
      <Sep />
      <Tool icon={Bold} label="Bold (Ctrl+B)" on={s.bold} onClick={() => c().toggleBold().run()} />
      <Tool icon={Italic} label="Italic (Ctrl+I)" on={s.italic} onClick={() => c().toggleItalic().run()} />
      <Tool icon={UnderlineIcon} label="Underline (Ctrl+U)" on={s.underline} onClick={() => c().toggleUnderline().run()} />
      <Tool icon={Strikethrough} label="Strike-through" on={s.strike} onClick={() => c().toggleStrike().run()} />
      <label className="eru-tool eru-swatch" title="Text colour">
        <span className="flex flex-col items-center leading-none" aria-hidden>
          <span className="text-[0.85rem] font-bold">A</span>
          <span className="mt-0.5 h-1 w-4 rounded" style={{ background: s.color }} />
        </span>
        <input type="color" aria-label="Text colour" value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#111827"} onChange={(e) => c().setColor(e.target.value).run()} />
      </label>
      <label className="eru-tool eru-swatch" title="Highlight colour">
        <span className="flex flex-col items-center leading-none" aria-hidden>
          <Highlighter size={14} />
          <span className="mt-0.5 h-1 w-4 rounded" style={{ background: s.highlight }} />
        </span>
        <input type="color" aria-label="Highlight colour" value={/^#[0-9a-f]{6}$/i.test(s.highlight) ? s.highlight : "#fde047"} onChange={(e) => c().setHighlight({ color: e.target.value }).run()} />
      </label>
      <Tool label="Remove highlight" onClick={() => c().unsetHighlight().run()}>
        <span className="text-[0.7rem] line-through" aria-hidden>
          HL
        </span>
      </Tool>
      <Sep />
      <Tool icon={AlignLeft} label="Align left" on={s.left} onClick={() => c().setTextAlign("left").run()} />
      <Tool icon={AlignCenter} label="Align centre" on={s.center} onClick={() => c().setTextAlign("center").run()} />
      <Tool icon={AlignRight} label="Align right" on={s.right} onClick={() => c().setTextAlign("right").run()} />
      <Tool icon={AlignJustify} label="Justify" on={s.justify} onClick={() => c().setTextAlign("justify").run()} />
      <Sep />
      <Tool icon={List} label="Bullet list" on={s.bullet} onClick={() => c().toggleBulletList().run()} />
      <Tool icon={ListOrdered} label="Numbered list" on={s.ordered} onClick={() => c().toggleOrderedList().run()} />
      <Sep />
      <Tool label="Heading 1" on={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        H1
      </Tool>
      <Tool label="Heading 2" on={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        H2
      </Tool>
      <Tool label="Heading 3" on={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        H3
      </Tool>
      <Tool icon={Quote} label="Quote" on={s.quote} onClick={() => c().toggleBlockquote().run()} />
      <Tool icon={Code2} label="Code block" on={s.code} blocked={trackOn ? CODE_LOCKED_MESSAGE : null} onBlocked={onBlocked} onClick={() => c().toggleCodeBlock().run()} />
      <Sep />
      <Tool icon={Undo2} label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => c().undo().run()} />
      <Tool icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={() => c().redo().run()} />
      <Sep />
      <Tool
        icon={MessageSquarePlus}
        label="Add a comment on the selected text (Ctrl+Alt+M)"
        disabled={!s.hasSelection}
        blocked={s.hasSelection && s.inCode ? NO_CODE_COMMENTS : null}
        onBlocked={onBlocked}
        onClick={onComment}
      />
    </div>
  );
}
