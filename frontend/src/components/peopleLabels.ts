import { personEmail, type DirectoryPerson } from "../api/graph";

/**
 * Display helpers for a `DirectoryPerson`, split out of PeoplePicker.tsx so that
 * file exports only its component (react-refresh) and the string logic is
 * testable without a DOM.
 */

/** The name to show: already defaulted by the api module, trimmed here. */
export function personLabel(person: DirectoryPerson): string {
  return person.display_name.trim() || person.id;
}

/**
 * The line under the name: what tells two people with the same name apart.
 * Email, job title and department; blanks are dropped rather than rendered as gaps.
 */
export function personMeta(person: DirectoryPerson): string {
  return [personEmail(person), person.job_title, person.department]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
