export const MAX_MEMBER_NAME_CODEPOINTS = 32
export const MAX_AGENT_DESCRIPTION_CODEPOINTS = 200

export type MemberNameReasonCode =
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "NAME_INVALID_HYPHEN"
  | "NAME_INVALID_CHARACTER"
  | "NAME_RESERVED_SERVER_SUFFIX"

export type MemberNameValidation = {
  valid: boolean
  available: boolean
  canonicalName: string | null
  canonicalReference: string | null
  reasonCode: MemberNameReasonCode | "NAME_UNAVAILABLE" | null
}

const MEMBER_CHARACTER = /^(?:\p{L}|\p{Nd})$/u
const RESERVED_SERVER_QUALIFIER = /-s[0-9abcdefghjkmnpqrstvwxyz]{4}$/

function invalid(reasonCode: MemberNameReasonCode): MemberNameValidation {
  return {
    valid: false,
    available: false,
    canonicalName: null,
    canonicalReference: null,
    reasonCode,
  }
}

/**
 * Browser mirror of backend/services/member_identity.py.
 * The backend remains authoritative; this mirror exists for immediate feedback
 * and is kept aligned through contracts/member-name-cases.json.
 */
export function validateMemberName(raw: unknown): MemberNameValidation {
  if (typeof raw !== "string") return invalid("NAME_REQUIRED")

  const canonicalName = raw.trim().normalize("NFC")
  const length = Array.from(canonicalName).length
  if (length === 0) return invalid("NAME_REQUIRED")
  if (length > MAX_MEMBER_NAME_CODEPOINTS) return invalid("NAME_TOO_LONG")
  if (canonicalName.startsWith("-") || canonicalName.endsWith("-")) {
    return invalid("NAME_INVALID_HYPHEN")
  }

  for (const character of canonicalName) {
    if (character !== "-" && !MEMBER_CHARACTER.test(character)) {
      return invalid("NAME_INVALID_CHARACTER")
    }
  }

  const lookupKey = canonicalName.normalize("NFKC").toLowerCase()
  if (RESERVED_SERVER_QUALIFIER.test(lookupKey)) {
    return invalid("NAME_RESERVED_SERVER_SUFFIX")
  }

  return {
    valid: true,
    available: true,
    canonicalName,
    canonicalReference: `@${canonicalName}`,
    reasonCode: null,
  }
}

export function codePointLength(value: string): number {
  return Array.from(value).length
}
