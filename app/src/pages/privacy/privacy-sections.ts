// Section order, anchors and headings for the privacy policy. The table of
// contents and the section headings both render from this list, so an anchor
// can never point at a section that is not on the page. Anchors are public
// (App Store Connect and support replies deep-link to them): do not rename.

export type PolicySectionId =
  | "who-we-are"
  | "summary"
  | "information-we-collect"
  | "how-we-use-information"
  | "ai-and-automated-processing"
  | "how-we-share-information"
  | "childrens-privacy"
  | "app-feedback"
  | "data-retention"
  | "your-choices-and-rights"
  | "security"
  | "where-information-is-processed"
  | "changes-to-this-policy"
  | "contact-us";

export const POLICY_SECTIONS: ReadonlyArray<{ id: PolicySectionId; title: string }> = [
  { id: "who-we-are", title: "Who we are" },
  { id: "summary", title: "Summary" },
  { id: "information-we-collect", title: "Information we collect" },
  { id: "how-we-use-information", title: "How we use information" },
  { id: "ai-and-automated-processing", title: "AI and automated processing" },
  { id: "how-we-share-information", title: "How we share information" },
  { id: "childrens-privacy", title: "Children's privacy" },
  { id: "app-feedback", title: "Optional application feedback" },
  { id: "data-retention", title: "Data retention" },
  { id: "your-choices-and-rights", title: "Your choices and rights" },
  { id: "security", title: "Security" },
  { id: "where-information-is-processed", title: "Where information is processed" },
  { id: "changes-to-this-policy", title: "Changes to this Policy" },
  { id: "contact-us", title: "Contact us" },
];

export const POLICY_EFFECTIVE_DATE = "September 20, 2026";
export const POLICY_LAST_UPDATED = "October 5, 2026";
export const POLICY_CONTACT_EMAIL = "nolanj@posetek.net";

/** 1-based section number shown in the heading badge and the contents list. */
export function sectionNumber(id: PolicySectionId): number {
  return POLICY_SECTIONS.findIndex(section => section.id === id) + 1;
}
