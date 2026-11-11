; Vendored unchanged from https://github.com/tree-sitter/tree-sitter-python/blob/293fdc02038ee2bf0e2e206711b69c90ac0d413f/queries/tags.scm
; tree-sitter-python v0.25.0, commit 293fdc02038ee2bf0e2e206711b69c90ac0d413f

(module (expression_statement (assignment left: (identifier) @name) @definition.constant))

(class_definition
  name: (identifier) @name) @definition.class

(function_definition
  name: (identifier) @name) @definition.function

(call
  function: [
      (identifier) @name
      (attribute
        attribute: (identifier) @name)
  ]) @reference.call
