/** The library's sections and the folders they start with. Pure data, so the library page's client parts can use it too (see library.ts). */

export type LibrarySection = "brand" | "templates" | "past";
/** The sections and the folders they start with. Fixed ids, so creating them is one statement that can never make two. */
export const LIBRARY_SECTIONS: { key: LibrarySection; id: string; name: string; hint: string; folders: { id: string; name: string }[] }[] = [
  {
    key: "brand",
    id: "00000000-0000-4000-8000-0000000d0001",
    name: "Brand Assets",
    hint: "Logos, colours, fonts, icons and letterheads",
    folders: [
      { id: "00000000-0000-4000-8000-0000000d0101", name: "Logos" },
      { id: "00000000-0000-4000-8000-0000000d0102", name: "Brand Colors" },
      { id: "00000000-0000-4000-8000-0000000d0103", name: "Fonts" },
      { id: "00000000-0000-4000-8000-0000000d0104", name: "Icons" },
      { id: "00000000-0000-4000-8000-0000000d0105", name: "Letterheads" },
    ],
  },
  {
    key: "templates",
    id: "00000000-0000-4000-8000-0000000d0002",
    name: "Templates",
    hint: "Standard templates to start a design from",
    folders: [
      { id: "00000000-0000-4000-8000-0000000d0201", name: "Social Media Templates" },
      { id: "00000000-0000-4000-8000-0000000d0202", name: "Event Templates" },
      { id: "00000000-0000-4000-8000-0000000d0203", name: "Presentations" },
    ],
  },
  { key: "past", id: "00000000-0000-4000-8000-0000000d0003", name: "Past Designs", hint: "Delivered designs, kept for reference", folders: [] },
];
const SECTION_IDS = new Set(LIBRARY_SECTIONS.map((x) => x.id));
export const isSectionFolder = (id: string) => SECTION_IDS.has(id);

