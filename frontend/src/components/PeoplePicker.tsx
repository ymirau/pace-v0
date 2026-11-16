import { useState } from "react";

import {
  DIRECTORY_DEBOUNCE_MS,
  MIN_DIRECTORY_TERM,
  personEmail,
  useDirectorySearch,
  type DirectoryPerson,
} from "../api/graph";
import { useDebounced } from "../hooks/useDebounced";
import { personLabel, personMeta } from "./peopleLabels";
import { Field, TextInput, btnClass } from "./ModalForm";

/**
 * People picker: a type-ahead over the Synveon Entra directory. Used by
 * Admin → Users → Add so an admin picks a person instead of typing (and possibly
 * mistyping) an email.
 *
 * A selection yields the person's **email** (the role key: `mail`, else the UPN)
 * and the **display name** Entra holds. Nothing typed into the box is ever kept:
 * the input is a query, not a value.
 *
 * The failure path is a first-class state: in local HTTP dev there is no Azure
 * session, and Graph can refuse. The reason is rendered (wording in
 * api/graph.ts), never an empty list.
 *
 * Every control comes from the ModalForm kit, so the 44px tap-target floor is
 * inherited rather than restated.
 */

/** What the caller stores: the role key and a display copy of the name. */
export interface PersonSelection {
  name: string;
  email: string;
}

interface PeoplePickerProps {
  /** The already-chosen person, echoed back so it can be seen and cleared. */
  value?: PersonSelection | null;
  onSelect: (selection: PersonSelection) => void;
  /** When given, a Clear button appears on the selected-person summary. */
  onClear?: () => void;
  /** Type-ahead debounce; tests pass 0 to make the query fire immediately. */
  debounceMs?: number;
  label?: string;
  required?: boolean;
}

export default function PeoplePicker({
  value,
  onSelect,
  onClear,
  debounceMs = DIRECTORY_DEBOUNCE_MS,
  label = "Person",
  required,
}: PeoplePickerProps) {
  const [term, setTerm] = useState("");
  const search = useDebounced(term, debounceMs).trim();

  // Below the minimum the query stays disabled (useDirectorySearch enforces the
  // same floor), but the reason has to be on screen, or one letter and nothing
  // back reads as a dead control.
  const tooShort = search.length > 0 && search.length < MIN_DIRECTORY_TERM;
  const { data, isLoading, isError, error } = useDirectorySearch(search);

  // An entry with neither mail nor UPN can't be granted a role: leave it out.
  const people: DirectoryPerson[] = (data ?? []).filter((person) => personEmail(person));
  const settled = search.length >= MIN_DIRECTORY_TERM && !isLoading && !isError;

  if (value) {
    return (
      <Field label={label} required={required}>
        <div className="rounded-md border border-slate-300 bg-surface px-3 py-2">
          <p className="text-sm text-slate-900">{value.name}</p>
          <p className="text-xs text-slate-600">{value.email}</p>
          {onClear && (
            <button type="button" className={`${btnClass} mt-2`} onClick={onClear}>
              Choose someone else
            </button>
          )}
        </div>
      </Field>
    );
  }

  return (
    <div>
      <TextInput
        label={label}
        required={required}
        type="search"
        aria-label={label}
        placeholder="Search company directory..."
        autoComplete="off"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />

      <Field>
        {tooShort && (
          <p className="text-sm text-slate-600">
            Keep typing: at least {MIN_DIRECTORY_TERM} characters.
          </p>
        )}

        {search.length >= MIN_DIRECTORY_TERM && isLoading && (
          <p className="text-sm text-slate-600">Searching the directory…</p>
        )}

        {search.length >= MIN_DIRECTORY_TERM && isError && (
          // Never an empty list: "nobody is called that" and "this app cannot
          // ask" look the same there, and only one of them has a fix.
          <p className="text-sm text-red-600">
            Directory search unavailable: {(error as Error).message}
          </p>
        )}

        {settled && people.length > 0 && (
          // Bounded and self-scrolling: a full page of matches must not push the
          // modal footer off a phone screen.
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="Directory">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className={`${btnClass} w-full justify-start text-left`}
                  onClick={() =>
                    onSelect({ name: personLabel(person), email: personEmail(person) ?? "" })
                  }
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-slate-900">{personLabel(person)}</span>
                    <span className="truncate font-normal text-slate-600">
                      {personMeta(person)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {settled && people.length === 0 && (
          <div>
            <p className="text-sm text-slate-900">No one in the directory matches “{search}”.</p>
            <p className="mt-1 text-xs text-slate-600">
              Try a surname, or the part of an email address before the @.
            </p>
          </div>
        )}
      </Field>
    </div>
  );
}
