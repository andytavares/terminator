// The risk grade and its words. Kept apart from the grader, which runs only in
// the main process, so the renderer can show a grade without pulling in Node.

export type RiskGrade = 'P0' | 'P1' | 'P2' | 'P3'

const GRADE_IN_WORDS: Record<RiskGrade, string> = {
  P0: 'highest risk',
  P1: 'elevated risk',
  P2: 'ordinary risk',
  P3: 'low risk',
}

/** A risk grade in words a person can read, never the bare code on its own. */
export function gradeInWords(grade: RiskGrade): string {
  return GRADE_IN_WORDS[grade]
}
