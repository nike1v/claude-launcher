// Shared helpers for invoking commands through a login bash shell so user
// PATH (e.g. ~/.local/bin from .profile) is picked up — Electron / wsl.exe /
// non-interactive ssh otherwise inherit a stripped PATH and miss claude
// installed via npm-global, asdf, mise, etc.

// POSIX single-quote escape: `'` becomes `'\''` to break out and re-enter
// the quoted region. Safe for arbitrary user-supplied strings.
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// `bash -lc <script> [argv0] [args...]` — running script through a login
// shell sources ~/.profile / ~/.bash_profile / ~/.zprofile equivalents.
// Returns spawn-style argv ready for bash. Pass `args` to expose them as
// $1.. inside the script via `"$@"`.
export function loginShellArgs(script: string, args: string[] = []): string[] {
  // The argv0 placeholder ("bash") becomes $0; subsequent items are $1..$N.
  return ['-lc', script, 'bash', ...args]
}
