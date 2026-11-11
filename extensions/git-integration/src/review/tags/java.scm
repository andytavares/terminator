; Vendored unchanged from https://github.com/tree-sitter/tree-sitter-java/blob/94703d5a6bed02b98e438d7cad1136c01a60ba2c/queries/tags.scm
; tree-sitter-java v0.23.5, commit 94703d5a6bed02b98e438d7cad1136c01a60ba2c

(class_declaration
  name: (identifier) @name) @definition.class

(method_declaration
  name: (identifier) @name) @definition.method

(method_invocation
  name: (identifier) @name
  arguments: (argument_list) @reference.call)

(interface_declaration
  name: (identifier) @name) @definition.interface

(type_list
  (type_identifier) @name) @reference.implementation

(object_creation_expression
  type: (type_identifier) @name) @reference.class

(superclass (type_identifier) @name) @reference.class
