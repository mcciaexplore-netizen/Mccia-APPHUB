/** The part of mammoth (.docx → HTML) the ERU import uses; the package ships no types of its own. */
declare module "mammoth" {
  type Image = { contentType: string; read: (encoding: "base64") => Promise<string> };
  type Options = { convertImage?: unknown; styleMap?: string[]; includeDefaultStyleMap?: boolean };
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Options): Promise<{ value: string; messages: { type: string; message: string }[] }>;
  export const images: { imgElement: (fn: (image: Image) => Promise<{ src: string; alt?: string }>) => unknown };
}
