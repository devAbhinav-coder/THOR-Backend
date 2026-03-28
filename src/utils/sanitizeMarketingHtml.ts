import sanitizeHtml from "sanitize-html";

/**
 * Strip scripts, event handlers, and dangerous URLs from admin-composed marketing HTML.
 */
export function sanitizeMarketingEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "b",
      "i",
      "em",
      "strong",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "span",
      "h1",
      "h2",
      "h3",
      "div",
      "blockquote",
      "hr",
    ],
    allowedAttributes: {
      a: ["href", "rel", "target", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {},
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    },
  });
}
