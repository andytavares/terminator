import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'

// The common set, not all ~190 languages: every extension this code maps is in
// it except Dockerfile, and the full build was 1 MB of the renderer bundle.
hljs.registerLanguage('dockerfile', dockerfile)

export default hljs
