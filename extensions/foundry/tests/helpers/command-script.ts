/** The script a command's terminal was asked to run: the last path its `-c` execs. */
export function scriptOf(input: { args: string[] }): string {
  const match = /'([^']+)'$/.exec(input.args[input.args.length - 1])
  if (match === null) throw new Error(`no script in ${input.args.join(' ')}`)
  return match[1]
}
