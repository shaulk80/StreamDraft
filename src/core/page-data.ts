/** One variable of a page's own scripts, as it travels from the page to the background. */
export interface PageData {
  name: string;
  /** The variable's value as JSON text; the extractor parses and validates it. */
  json: string;
}
